/// <reference path='../defs/todos.d.ts' />

module Todos {
  'use strict';

  export class Start implements Woc.StartingPoint {
    private model: Todos.Model;

    constructor(private sc: Woc.ServiceContext) {
      this.model = this.sc.getService('Todos.Model');
    }

    public start(el: HTMLElement) {
      el.classList.add('AppWrapper');
      this.sc.createComponent('Public.ScreenRouter', [
        {
          route: '',
          comp: this.sc.createComponent('Todos.List'),
          title: 'List of tasks',
          activate: (query: EasyRouter.Query, comp: Todos.List) => {
            comp.refresh();
          }
        },
        {
          route: 'todos/:taskId',
          comp: this.sc.createComponent('Todos.EditPanel'),
          canActivate: (query: EasyRouter.Query) => {
            var id = parseInt(query.routeParams['taskId'], 10);
            return this.model.getTask(id) ? true : false;
          },
          title: (query: EasyRouter.Query) => {
            var id = parseInt(query.routeParams['taskId'], 10),
              task = this.model.getTask(id);
            return task.title + ' | Edition';
          },
          activate: (query: EasyRouter.Query, comp: Todos.EditPanel) => {
            var id = parseInt(query.routeParams['taskId'], 10);
            comp.setTask(id);
          }
        }
      ]).attachTo(el);
    }
  }
}
