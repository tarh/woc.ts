class Container<C> {
  public /* readonly */ inst: C & Component<C>
  public /* readonly */ bkb: Bkb<C>
  public /* readonly */ context: Context<any>

  private emitter: Emitter
  private childEmitter: ChildEmitter
  private childGroups: Map<string, Set<number>>

  constructor(private app: ApplicationContainer<any>, public /* readonly */ componentName, public /* readonly */ componentId: number) {
    this.emitter = new Emitter(app, ['destroy'])
    this.childEmitter = new ChildEmitter(app)
  }

  public initBkbAndContext(bkbMethods?: any) {
    this.bkb = this.makeBkb(bkbMethods)
    this.context = this.makeContext(this.bkb)
  }

  public exposeEvents(eventNames: string[], strictEventsMode: boolean) {
    this.emitter.exposeEvents(eventNames, strictEventsMode)
  }

  public createInstance(Cl, args: any[]) {
    this.inst = new Cl(this.context, ...args)
    if (this.inst.bkb)
      throw new Error(`A component cannot have a member "bkb" (${Cl})`)
    this.inst.bkb = this.bkb
  }

  public createFromObject(obj): C {
    if (obj.bkb)
      throw new Error(`A component cannot have a member "bkb"`)
    obj.bkb = this.bkb
    this.inst = obj
    return this.inst
  }

  private makeBkb(bkbMethods?: any): Bkb<C> {
    let obj: Bkb<C> = {
      getInstance: () => this.inst,
      getParent: () => this.app.getParentOf(this.componentId),
      on: <D>(eventName: string, callback: (evt: ComponentEvent<C, D>) => void) => {
        this.emitter.listen(eventName).call(callback)
        return bkb
      },
      listen: (eventName: string) => this.emitter.listen(eventName),
      destroy: () => {
        this.destroy()
      },
      componentName: this.componentName,
      componentId: this.componentId,
      find: <E>(filter: ChildFilter = {}) => this.find<E>(filter),
      findSingle: <E>(filter: ChildFilter = {}) => this.findSingle<E>(filter)
    }
    if (bkbMethods)
      obj = Object.assign(obj, bkbMethods)
    const bkb = Object.freeze(obj)
    return bkb
  }

  private makeContext(bkb: Bkb<C>): Context<any> {
    const context = Object.freeze({
      app: this.app.root ? this.app.root.inst : null, // The root context doesn't need this property
      bkb: bkb,
      exposeEvents: (eventNames: string[]) => {
        this.exposeEvents(eventNames, true)
        return context
      },
      emit: <D>(eventName: string, data?: D, options?: EmitterOptions) => {
        this.emit<D>(eventName, data, options)
        return context
      },
      broadcast: (evt: ComponentEvent<any, any>, options?: EmitterOptions) => {
        this.broadcast(evt, options)
        return context
      },
      listenChildren: <C, D>(eventName: string, filter?: ChildFilter) => this.childEmitter.listen<C, D>(eventName, filter),
      listenParent: <C, D>(eventName: string, filter: ParentFilter = {}) => this.listenParent<C, D>(eventName, filter),
      listenComponent: <C, D>(component: Component<C>, eventName: string) => this.listenComponent<C, D>(component, eventName),
      createComponent: <C>(Cl: { new(): C }, properties: NewComponentProperties = {}) => this.createComponent<C>(Cl, properties, false).inst,
      toComponent: <C>(obj, properties: NewComponentProperties = {}) => this.createComponent<C>(obj, properties, true).context,
      find: <C>(filter: ChildFilter = {}): C[] => this.find<C>(filter),
      findSingle: <C>(filter: ChildFilter = {}) => this.findSingle<C>(filter)
    })
    return context
  }

  private createComponent<E>(objOrCl, properties: NewComponentProperties, asObject: boolean): Container<E> {
    const child = this.app.createComponent<E>(objOrCl, this, asObject, properties)
    if (properties.groupName) {
      if (!this.childGroups)
        this.childGroups = new Map<SHIM_ANY, SHIM_ANY>()
      const groupNames = <string[]>(typeof properties.groupName === 'string' ? [properties.groupName] : properties.groupName)
      for (const name of groupNames) {
        if (!this.childGroups.has(name))
          this.childGroups.set(name, new Set<SHIM_ANY>())
        this.childGroups.get(name).add(child.componentId)
      }
    }
    return child
  }

  private find<C>(filter: ChildFilter): C[] {
    if (filter.deep)
      throw new Error('Cannot call "find" with filter deep')
    const containers = this.getChildContainers(filter.groupName)
    const result = []
    for (const child of containers) {
      if (!filter.componentName || filter.componentName === child.componentName)
        result.push(child.inst)
    }
    return result
  }

  private findSingle<C>(filter: ChildFilter): C {
    const list = this.find<C>(filter)
    if (list.length !== 1)
      throw new Error(`Cannot find single ${JSON.stringify(filter)} in ${this.componentName} ${this.componentId}`)
    return list[0]
  }

  private getChildContainers(groupName?: string | string[]): Container<any>[] {
    if (!groupName)
      return this.app.getChildrenOf(this.componentId)
    if (!this.childGroups)
      return []
    const names = <string[]>(typeof groupName === 'string' ? [groupName] : groupName)
    const idSet = new Set<number>()
    for (const name of names) {
      const group = this.childGroups.get(name)
      if (!group)
        continue
      for (const id of Array.from(group.values()))
        idSet.add(id)
    }
    const containers = []
    for (const id of Array.from(idSet.values()))
      containers.push(this.app.getContainer(id))
    return containers
  }

  private emit<D>(eventName: string, data?: D, options?: EmitterOptions) {
    if (options && options.sync)
      this.emitSync(this.createEvent<D>(eventName, data))
    else
      this.app.nextTick(() => this.emitSync<D>(this.createEvent<D>(eventName, data)))
  }

  private createEvent<D>(eventName, data?: D) {
    if (!this.inst)
      throw new Error(`Cannot fire an event ${eventName} from an uninitialized component ${this.componentName}`)
    let canPropagate = true
    let evt: ComponentEvent<C, D> = {
      eventName: eventName,
      sourceName: this.componentName,
      sourceId: this.componentId,
      source: this.inst,
      data,
      stopPropagation: () => {
        canPropagate = false
      }
    }
    evt['_canPropagate'] = () => canPropagate
    return Object.freeze(evt)
  }

  private emitSync<D>(evt: ComponentEvent<C, D>) {
    this.emitter.emit(evt.eventName, [evt])
    const parent = this.app.getParentOf(this.componentId)
    if (parent)
      parent.bubbleUpEvent<C, D>(evt, false, this.componentId)
  }

  private bubbleUpEvent<C, D>(evt: ComponentEvent<C, D>, isFromDeep: boolean, childId: number) {
    if (evt['_canPropagate'] && !evt['_canPropagate']())
      return
    this.childEmitter.emit<C, D>(evt, isFromDeep, this.getGroupsOf(childId))
    const parent = this.app.getParentOf(this.componentId)
    if (parent)
      parent.bubbleUpEvent<C, D>(evt, true, this.componentId)
  }

  private broadcast(evt: ComponentEvent<any, any>, options?: EmitterOptions) {
    if (options && options.sync)
      this.emitter.emit(evt.eventName, [evt])
    else
      this.app.nextTick(() => this.emitter.emit(evt.eventName, [evt]))
  }

  private getGroupsOf(childId: number): Set<string> {
    const result = new Set<string>()
    if (this.childGroups) {
      for (const [groupName, idSet] of Array.from(this.childGroups.entries())) {
        if (idSet.has(childId))
          result.add(groupName)
      }
    }
    return result
  }

  private listenParent<C, D>(eventName: string, filter: ParentFilter): ComponentListener<C, D> {
    let parent: Container<any> = this
    while (parent = this.app.getParentOf(parent.componentId)) {
      if (!filter.componentName || filter.componentName === parent.componentName)
        return parent.emitter.listen(eventName, this)
    }
    if (filter.componentName)
      throw new Error(`Unknown parent ${filter.componentName}`)
    return ChildEmitter.empty()
  }

  private listenComponent<C, D>(component: Component<C>, eventName: string): ComponentListener<C, D> {
    return this.app.getContainer(component.bkb.componentId).emitter.listen(eventName, this)
  }

  public destroy() {
    this.emit('destroy', undefined, {sync: true})
    this.app.removeComponent(this)
    if (this.childGroups)
      this.childGroups.clear()
    this.emitter.destroy()
    this.childEmitter.destroy()
    this.bkb = null
    this.context = null
    this.inst.bkb = null
    this.inst = null
  }

  public forgetChild(componentId: number) {
    if (this.childGroups) {
      for (const group of Array.from(this.childGroups.values()))
        group.delete(componentId)
    }
  }
}