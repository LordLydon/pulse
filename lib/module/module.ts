import { collectionFunctions, objectLoop, createObj } from '../helpers';
import Reactive from '../reactive';
import Action from '../action';
import Computed from '../computed';
import { JobType } from '../runtime';
import {
  Methods,
  Keys,
  CollectionObject,
  CollectionConfig,
  Global,
  ModuleInstance
} from '../interfaces';
import { normalizeGroups } from '../helpers';
import Dep from '../dep';

// modules have a contained reactivity system which is the base
// of collections, services and
export default class Module {
  public public: Reactive;
  public keys: Keys = {};
  public onReady?: Function;
  public methods: Methods = {};
  public local: { [key: string]: any } = {};

  protected namespace: CollectionObject;
  protected config: CollectionConfig = {}; //rename
  protected actions: { [key: string]: Action } = {};
  protected computed: { [key: string]: Computed } = {};
  protected watchers: { [key: string]: any } = {};
  protected externalWatchers: { [key: string]: any } = {};
  protected persist: Array<string> = [];
  protected model: { [key: string]: any } = {};
  protected throttles: Array<Action> = [];
  protected localContext: any;

  constructor(
    public name: string,
    public global: Global,
    protected root: CollectionObject
  ) {
    // define aliases
    this.config = root.config;

    // create this.root
    root = this.prepareRoot(root);

    // Prepare methods
    collectionFunctions.map(
      func => this[func] && (this.methods[func] = this[func].bind(this))
    );

    let publicObject = this.preparePublicNamespace(root);

    // create public object
    this.keys.data = Object.keys(root.data || {});

    this.public = new Reactive(this, publicObject, this.keys.data);

    if (root.staticData) {
      this.keys.staticData = Object.keys(root.staticData);
      for (let property in root.staticData)
        if (root.staticData.hasOwnProperty(property))
          this.public.privateWrite(property, root.staticData[property]);
    }

    // init module features
    this.initActions(root.actions);
    this.initWatchers(root.watch);
    this.initComputed(root.computed);

    if (this.global.request || root.request) this.initRoutes(root.routes);

    // load persisted data from storage
    this.initPersist(root.persist);

    this.prepareLocalContext();

    // init finished
    if (root.onReady) this.onReady = root.onReady;
  }

  // this function is where any transforms to the root object
  // should be done, before namspace is initilized
  private prepareRoot(root: CollectionObject) {
    root.computed = { ...root.computed, ...root.filters }; // legacy support

    this.root = root;
    return root;
  }

  private preparePublicNamespace(root) {
    interface PublicNamespace {
      routes?: Object;
      indexes?: Object;
      local?: Object;
    }

    const publicNamespace: PublicNamespace = {};

    // insert static properties
    const types = ['routes', 'indexes', 'local'];
    types.forEach(
      type => root[type] && (publicNamespace[type] = { ...root[type] })
    );

    let namespaceWithMethods = Object.assign(
      Object.create(this.methods),
      publicNamespace,
      ...root.data,
      ...root.computed
      // ...root.actions
    );

    return namespaceWithMethods;
  }

  private initRoutes(routes: object = {}) {
    // @ts-ignore
    this.keys.routes = Object.keys(routes);

    const routeWrapped = routeName => {
      let self = this;
      return function() {
        let requestObject = Object.assign({}, self.global.request);
        // @ts-ignore
        requestObject.context = self.global.contextRef;

        return routes[routeName].apply(
          null,
          [requestObject].concat(Array.prototype.slice.call(arguments))
        );
      };
    };

    for (let routeName in routes) {
      this.public.object.routes[routeName] = routeWrapped(routeName);
    }
  }

  private initActions(actions: object = {}) {
    this.keys.actions = Object.keys(actions);

    for (let actionName in actions) {
      this.actions[actionName] = new Action(
        this,
        this.global,
        actions[actionName],
        actionName
      );
      this.public.privateWrite(actionName, this.actions[actionName].exec);
    }
  }

  private initWatchers(watchers: object = {}): void {
    // @ts-ignore
    this.keys.watchers = Object.keys(watchers);

    for (let watcherName in watchers) {
      let watcher = watchers[watcherName];

      this.watchers[watcherName] = () => {
        this.global.runningWatcher = true;
        let watcherOutput = watcher(this.global.getContext(this));
        this.global.runningWatcher = false;
        return watcherOutput;
      };
    }
  }
  private initComputed(computed: object = {}): void {
    this.keys.computed = Object.keys(computed);

    for (let computedName in computed) {
      this.computed[computedName] = new Computed(
        this.global,
        this,
        computedName,
        computed[computedName]
      );
      this.public.privateWrite(
        computedName,
        this.global.config.computedDefault
      );
    }
  }

  public initPersist(persist: Array<string> = []): void {
    if (!Array.isArray(persist)) return;

    for (let i = 0; i < persist.length; i++) {
      const dataName = persist[i];

      // register this
      this.persist.push(dataName);

      if (this.global.storage.isPromise) {
        this.global.storage.get(this.name, dataName).then(data => {
          if (data === undefined || data === null) return;
          this.global.ingest({
            type: JobType.PUBLIC_DATA_MUTATION,
            value: data,
            property: dataName,
            collection: this,
            dep: this.getDep(dataName)
          });
        });
      } else {
        let data = this.global.storage.get(this.name, dataName);
        if (data === undefined || data === null) continue;
        this.public.privateWrite(dataName, data);
      }
    }
  }
  public runWatchers(property) {
    const watcher = this.watchers[property];
    if (watcher) watcher();
    const externalWatchers = this.externalWatchers[property];
    if (externalWatchers)
      externalWatchers.forEach(func =>
        typeof func === 'function' ? func() : false
      );
  }

  public prepareLocalContext() {
    this.localContext = {
      data: {},
      computed: {}
    };

    let l = this.localContext;

    for (let type in l)
      for (let propertyName of this.keys[type])
        this.public.createReactiveAlias(l[type], propertyName);

    if (this.keys.staticData)
      for (let property of this.keys.staticData)
        l.data[property] = this.public.privateGet(property);

    // insert static properties
    l.local = this.root.local;
    l.actions = createObj(this.keys.actions, this.public.object);
    l.routes = this.public.object.routes;

    if (this.keys.indexes) {
      // @ts-ignore
      l.indexes = this.indexes.public.object;
    }

    for (let method in this.methods) l[method] = this.methods[method];
  }

  public getSelfContext() {
    const globalContext = this.global.contextRef;
    let context = { ...globalContext, ...this.localContext };
    return context;
  }
  public getDep(
    propertyName: string | number,
    reactiveObject?: Object
  ): Dep | boolean {
    let dep: Dep;

    this.global.touching = true;
    // if the property is on a deep reactive object or an index
    if (reactiveObject) reactiveObject[propertyName];
    // by default we assume the module's public object
    else this.public.object[propertyName];

    // extract the dep from global
    dep = this.global.touched as Dep;

    // reset state
    this.global.touching = false;
    this.global.touched = null;

    return dep;
  }

  public isComputedReady(computedName: string) {
    return this.computed[computedName].hasRun;
  }

  // ****************** EXTERNAL METHODS ****************** //

  private watch(property, callback) {
    if (!this.externalWatchers[property])
      this.externalWatchers[property] = [callback];
    else this.externalWatchers[property].push(callback);
  }
  private forceUpdate(property: string): void {
    // ensure property exists on collection
    if (this.public.exists(property)) {
      // if property is directly mutable

      if (this.public.mutableProperties.includes(property)) {
        this.global.ingest({
          type: JobType.PUBLIC_DATA_MUTATION,
          property,
          collection: this,
          value: this.public.privateGet(property),
          dep: this.getDep(property)
        });

        // if property is a computed method
      } else if (this.computed[property]) {
        this.global.ingest({
          type: JobType.COMPUTED_REGEN,
          property,
          collection: this,
          dep: this.getDep(property)
        });
        // @ts-ignore
      } else if (this.indexes && this.indexes.exists(property)) {
        this.global.ingest({
          type: JobType.GROUP_UPDATE,
          property,
          collection: this, 
          // @ts-ignore
          dep: this.getDep(property, this.indexes.object)
        });
      }
    }
  }
  private throttle(amount: number = 0): void {
    // if action is currently running save in throttles
    if (this.global.runtime.runningAction) {
      this.throttles.push(this.global.runtime.runningAction as Action);
    }

    // after the certain amount has possed remove the throttle via filter
    setTimeout(() => {
      this.throttles = this.throttles.filter(
        action => action !== (this.global.runtime.runningAction as Action)
      );
    }, amount);
  }

  private addStaticData(key: string, data: any) {
    if (
      this.keys.staticData.includes(key) ||
      this.public.getKeys().includes(key)
    )
      throw 'Pulse: failed to add static data, key already exists';

    this.keys.staticData.push(key);
    this.public.privateWrite(key, data);
    this.prepareLocalContext(); // recompute local context;
  }

  // WIP DO NOT USE
  private async debounce(
    func: Function,
    amount: number,
    options?: Array<string>
  ) {
    // if (!this.global.runtime.runningAction) return await setTimeout(func, amount);

    let action = this.global.runtime.runningAction as Action;

    action.softDebounce(func, amount);
    return;

    return await action.softDebounce(func, amount);
  }
}
