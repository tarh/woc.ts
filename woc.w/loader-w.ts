/// <reference path="loader.ts" />
'use strict';

module woc {

	// ##
	// ## WLoader
	// ##

	interface WBundleProp {
		path: string;
		embedPath: string;
		url: string;
		conf: {};
	}
	interface WThingProp {
		type: WEmbedType;
		path: string;
		url: string;
		confUrl: string;
		bundleProp: WBundleProp;
		conf: {}
	}
	enum WEmbedType {
		Component, Library, Service, Bundle
	}

	export class WLoader {

		// --
		// -- Initialisation
		// --

		private ajax: woc.Ajax;
		private embedBundleList: WBundleProp[] = [];
		private preloads: Promise<void>[] = [];

		constructor(private libraries: Libraries, private services: Services, private components: Components, private bundles: Bundles,
								private loader: Loader, private bundlePath: string, private bundleUrl: string, private version: string) {
			this.ajax = this.services.get('woc.Ajax');
		}

		// --
		// -- Public
		// --

		public loadWBundle(): Promise<void> {
			return this.loadBundleConfRecursive(this.bundlePath, null, this.bundleUrl).then(() => {
				return Promise.all(this.preloads);
			}).then(() => {
				var lsc = new WLoaderLSC(this.libraries, this.services, this.components, this.ajax, this.bundlePath, this.bundleUrl,
					this.embedBundleList);
				return lsc.loadAll();
			}).then((prop: WBundleProp) => {
				var conf = prop['conf'];
				if (conf['version'] && this.version && conf['version'] !== this.version)
					throw Error('Conflict in bundle version, attempted "' + this.version + '" doesn\'nt match with current "' + conf['version'] + '"');
				this.bundles.register(this.bundlePath, this.bundleUrl, null, null, conf['main']);
			});
		}

		// --
		// -- Private - Embed bundles
		// --

		private loadBundleConfRecursive(bundlePath, bundleEmbedPath, bundleUrl): Promise<void> {
			return this.ajax.get(bundleUrl + '/bundle.json').then((bundleConf) => {
				if (bundleConf['preload']) {
					Array.prototype.push.apply(this.preloads, bundleConf['preload'].map((bp) => {
						return this.loader.loadBundle(bp, null, null, false, false);
					}));
				}
				this.embedBundleList.push({
					path: bundlePath,
					embedPath: bundleEmbedPath,
					url: bundleUrl,
					conf: bundleConf
				});
				if (bundleConf['embed'] !== undefined) {
					return Promise.all(bundleConf['embed'].map((dir) => {
						if (WLoaderLSC.getType(dir) !== WEmbedType.Bundle)
							return null;
						var childEmbedPath = bundleEmbedPath === null ? dir : bundleEmbedPath + '/' + bundleEmbedPath;
						return this.loadBundleConfRecursive(bundlePath + '/' + dir, childEmbedPath, bundleUrl + '/' + dir);
					}));
				}
			});
		}
	}
	
	// ##
	// ## WLoaderLibServComp
	// ##

	class WLoaderLSC {
		
		private mergedBundleConf: {};
		private thingList: WThingProp[];

		constructor(private libraries: Libraries, private services: Services, private components: Components, private ajax: woc.Ajax,
								private bundlePath: string, private bundleUrl: string, private embedBundleList: WBundleProp[] = []) {
			this.initMergedBundleConf();
			this.initThingList();
			this.initThingList();
		}

		public loadAll(): Promise<void> {
			return Promise.all(this.thingList.map((prop) => {
				return this.ajax.get(prop.confUrl);
			})).then((confList) => {
				for (var i = 0, len = this.thingList.length; i < len; ++i)
					this.thingList[i].conf = confList[i];
				return this.fillFileLoaders();
			}).then((tplMap) => {
				return this.registerAll(tplMap);
			});
		}

		/**
		 * @returns A promise which returns the map of templates
		 */
		private fillFileLoaders(): Promise<{[index: string]: string}> {
			var scriptLoader = new WScriptLoader(this.libraries);
			var cssLoader = new WCssLoader();
			var tplLoader = new WTplLoader(this.ajax);
			// - Libraries, Services, Components
			var prop: WThingProp;
			for (var i = 0, len = this.thingList.length; i < len; ++i) {
				prop = this.thingList[i];
				switch(prop.type) {
					case WEmbedType.Library:
						scriptLoader.addLib(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['script']), prop.conf['requireLib']);
						cssLoader.add(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['css']));
						break;
					case WEmbedType.Service:
						scriptLoader.add(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['script']), prop.conf['requireLib']);
						break;
					case WEmbedType.Component:
						scriptLoader.add(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['script']), prop.conf['requireLib']);
						cssLoader.add(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['css']));
						tplLoader.add(prop.conf['name'], prop.url, WLoaderLSC.toFileList(prop.conf['tpl']));
						break;
				}
			}
			// - Bundle
			scriptLoader.add(this.bundlePath, this.bundleUrl, WLoaderLSC.toFileList(this.mergedBundleConf['script']),
				this.mergedBundleConf['requireLib']);
			cssLoader.add(this.bundlePath, this.bundleUrl, WLoaderLSC.toFileList(this.mergedBundleConf['css']));
			// - Promises
			return Promise.all([
				scriptLoader.getPromise(),
				cssLoader.getPromise(),
				tplLoader.getPromise()
			]).then((arr) => {
				return arr[2];
			});
		}

		private initMergedBundleConf() {
			var j, lenJ, reqLib, bundleProp, reqLibSet = {}, scripts = [], cssList = [], encoding = null;
			for (var i = 0, len = this.embedBundleList.length; i < len; ++i) {
				bundleProp = this.embedBundleList[i];
				if (!encoding)
					encoding = bundleProp.conf['encoding'];
				else if (bundleProp.conf['encoding'] && encoding !== bundleProp.conf['encoding'])
					throw Error('Encoding conflict with embed bundles: "' + encoding + '" doesn\'t match with "' + bundleProp.conf['encoding'] + '"');
				reqLib = bundleProp.conf['requireLib'];
				if (reqLib !== undefined) {
					for (j = 0, lenJ = reqLib.length; j < lenJ; ++j)
						reqLibSet[reqLib[j]] = true;
				}
				if (bundleProp.conf['script'] !== undefined)
					Array.prototype.push.apply(scripts, WLoaderLSC.toFileList(bundleProp.conf['script'], bundleProp.embedPath));
				if (bundleProp.conf['css'] !== undefined)
					Array.prototype.push.apply(cssList, WLoaderLSC.toFileList(bundleProp.conf['css'], bundleProp.embedPath));
			}
			var reqLibList = [];
			for (var libName in reqLibSet) {
				if (reqLibSet.hasOwnProperty(libName))
					reqLibList.push(libName);
			}
			this.mergedBundleConf = {
				'encoding': encoding,
				'requireLib': reqLibList,
				'script': scripts,
				'css': cssList
			};
		}

		private initThingList() {
			this.thingList = [];
			var j, lenJ, embed, dir, url, type, bundleProp;
			for (var i = 0, len = this.embedBundleList.length; i < len; ++i) {
				bundleProp = this.embedBundleList[i];
				embed = bundleProp.conf['embed'];
				if (embed === undefined)
					continue;
				for (j = 0, lenJ = embed.length; j < lenJ; ++j) {
					dir = embed[j];
					type = WLoaderLSC.getType(dir);
					if (type === WEmbedType.Bundle)
						continue;
					url = bundleProp.url + '/' + dir;
					this.thingList.push({
						type: type,
						path: dir,
						url: url,
						confUrl: url + '/' + WLoaderLSC.getConfFileName(type),
						bundleProp: bundleProp,
						conf: null
					});
				}
			}
		}

		private registerAll(tplMap: {}) {
			// - Make lists
			var libList: WThingProp[] = [],
				servList: WThingProp[] = [],
				compList: WThingProp[] = [];
			var prop: WThingProp;
			for (var i = 0, len = this.thingList.length; i < len; ++i) {
				prop = this.thingList[i];
				switch (prop.type) {
					case WEmbedType.Library:
						libList.push(prop);
						break;
					case WEmbedType.Service:
						servList.push(prop);
						break;
					case WEmbedType.Component:
						compList.push(prop);
						break;
					default:
						throw Error('Invalid type "' + prop.type + '"');
				}
			}
			// - Libraries
			for (var i = 0, len = libList.length; i < len; ++i)
				this.libraries.register(libList[i].conf['name'], null, null);
			// - Services
			for (var i = 0, len = servList.length; i < len; ++i)
				this.services.register(servList[i].conf['name'], servList[i].url, servList[i].conf['alias'], null, null);
			// - Components
			for (var i = 0, len = compList.length; i < len; ++i)
				this.components.register(compList[i].conf['name'], compList[i].url, null, null, tplMap[compList[i].conf['name']]);
		}

		// --
		// -- Private - Static tools
		// --

		static getType(dir: string) {
			var last = dir.length - 1;
			if (last <= 2 || dir[last - 1] !== '.')
				throw Error('Invalid embed "' + dir + '"');
			switch(dir[last]) {
				case 's':
					return WEmbedType.Service;
				case 'c':
					return WEmbedType.Component;
				case 'l':
					return WEmbedType.Library;
				case 'w':
					return WEmbedType.Bundle;
				default:
					throw Error('Invalid embed "' + dir + '"');
			}
		}

		private static getConfFileName(type: string) {
			switch(type) {
				case WEmbedType.Service:
					return 'serv.json';
				case WEmbedType.Component:
					return 'comp.json';
				case WEmbedType.Library:
					return 'lib.json';
				default:
					throw Error('Invalid conf file type "' + type + '"');
			}
		}

		public static toFileList(script: any, pathPrefix: string = null): string[] {
			script = script ? (typeof script === 'string' ? [script] : script) : [];
			if (pathPrefix) {
				for (var i = 0, len = script.length; i < len; ++i)
					script[i] = pathPrefix + '/' + script[i];
			}
			return script;
		}
	}

	// ##
	// ## WScriptLoader
	// ##

	class WScriptLoader {
		private urlValidator = new WUniqueUrlValidator();
		private libMap = {};
		private waitList = [];
		private promises = [];
		private mustLoadAll = false;
		private runCount = 0;

		constructor(private libraries: Libraries) {
		}

		public add(thingName: string, baseUrl: string, relUrls: string[], requireLib: string[] = []) {
			this.doAdd(thingName, baseUrl, relUrls, requireLib, null);
		}

		public addLib(libName: string, baseUrl: string, relUrls: string[], requireLib: string[] = []) {
			if (this.libMap[libName] === true || (this.libMap[libName] === undefined && this.libraries.load(name, false)))
				throw Error('Library "' + libName + '" is already defined');
			this.libMap[libName] = false;
			this.doAdd(libName, baseUrl, relUrls, requireLib, libName);
		}

		public getPromise(): Promise<void> {
			if (this.promises.length === 0 && this.waitList.length > 0)
				return Promise.reject(Error('Fail to load scripts for: ' + this.toDebugStringWait()));
			this.mustLoadAll = true;
			return <any>Promise.all(this.promises);
		}

		private doAdd(thingName: string, baseUrl: string, relUrls: string[], requireLib: string[], libName: string) {
			this.urlValidator.add(baseUrl, relUrls);
			this.fillLibMap(requireLib);
			this.waitList.push({
				'thingName': thingName,
				'libName': libName,
				'baseUrl': baseUrl,
				'relUrls': relUrls,
				'requireLib': requireLib
			});
			this.runWaited();
		}

		private loadUrls(baseUrl: string, relUrls: string[]) {
			relUrls.forEach((relUrl) => {
				++this.runCount;
				this.promises.push(WScriptLoader.addScriptToDOM(baseUrl + '/' + relUrl).then(() => {
					--this.runCount;
					this.runWaited();
				}));
			});
		}

		private runWaited() {
			var prop, withStarted = false, hasWaited = false;
			for (var k in this.waitList) {
				if (!this.waitList.hasOwnProperty(k))
					continue;
				prop = this.waitList[k];
				if (this.areLibReady(prop['requireLib'])) {
					withStarted = true;
					this.loadUrls(prop['baseUrl'], prop['relUrls']);
					if (prop['libName'])
						this.libMap[prop['libName']] = true;
					delete this.waitList[k];
				} else
					hasWaited = true;
			}
			if (this.mustLoadAll && !withStarted && hasWaited && this.runCount === 0)
				throw Error('Fail to load scripts for: ' + this.toDebugStringWait());
		}

		private areLibReady(requireLib: string[]) {
			for (var i = 0, len = requireLib.length; i < len; ++i) {
				if (!this.libMap[requireLib[i]])
					return false;
			}
			return true;
		}

		private fillLibMap(requireLib: string[]) {
			var name: string;
			for (var i = 0, len = requireLib.length; i < len; ++i) {
				name = requireLib[i];
				if (this.libMap[name] === undefined)
					this.libMap[name] = this.libraries.load(name, false);
			}
		}

		private toDebugStringWait() {
			var list = [];
			for (var k in this.waitList) {
				if (!this.waitList.hasOwnProperty(k))
					continue;
				list.push(this.waitList[k]['thingName']);
			}
			return list.join(', ');
		}

		private static addScriptToDOM(url): Promise<void> {
			return new Promise(function (resolve, reject) {
				var script = document.createElement('script');
				if (script.onreadystatechange) { // IE8
					script.onreadystatechange = function () {
						if (script.readyState === 'complete')
							resolve();
						else
							reject();
					};
				} else {
					script.onload = resolve;
					script.onerror = reject;
				}
				script.src = url;
				var head: HTMLHeadElement = document.head || document.getElementsByTagName('head')[0];
				head.appendChild(script);
			});
		}
	}

	// ##
	// ## WCssLoader
	// ##

	class WCssLoader {
		private urlValidator = new WUniqueUrlValidator();
		private promises = [];

		constructor() {
		}

		public add(thingName: string, baseUrl: string, relUrls: string[]) {
			this.urlValidator.add(baseUrl, relUrls);
			this.promises.push(Promise.all(relUrls.map((relUrl) => {
				return Loader.addCssLinkToDOM(baseUrl + '/' + relUrl);
			})).catch((e: Error) => {
				throw Error('Fail to load CSS of "' + thingName + '": ' + e.message);
			}));
		}

		public getPromise(): Promise<void> {
			return <any>Promise.all(this.promises);
		}
	}

	// ##
	// ## WTplLoader
	// ##

	class WTplLoader {
		private urlValidator = new WUniqueUrlValidator();
		private compNames = [];
		private promises = [];

		constructor(private ajax: woc.Ajax) {
		}

		public add(compName: string, baseUrl: string, relUrls: string[]) {
			this.urlValidator.add(baseUrl, relUrls);
			this.compNames.push(compName);
			this.promises.push(Promise.all(relUrls.map((relUrl) => {
				return this.ajax.get(baseUrl + '/' + relUrl, {'rDataType': 'text'});
			})).then((arr: string[]) => {
				return arr.join('\n');
			}, (e: Error) => {
				throw Error('Fail to load templates in "' + compName + '": ' + e.message);
			}));
		}

		public getPromise(): Promise<{[index: string]: string}> {
			return Promise.all(this.promises).then((arr: string[]) => {
				var map = {};
				for (var i = 0, len = arr.length; i < len; ++i)
					map[this.compNames[i]] = arr[i];
				return map;
			});
		}
	}

	// ##
	// ## WUniqueUrlValidator
	// ##

	class WUniqueUrlValidator {
		private urlSet = {};

		public add(baseUrl: string, relUrls: string[]) {
			var url;
			for (var i = 0, len = relUrls.length; i < len; ++i) {
				url = baseUrl + '/' + relUrls[i];
				if (this.urlSet[url])
					throw Error('URL "' + url + '" cannot be included twice');
				this.urlSet[url] = true;
			}
		}
	}
}