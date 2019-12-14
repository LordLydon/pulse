export default {
  name: 'vue',
  bind(pulseConstructor) {
    pulseConstructor.install = Vue => {
      const pulse = globalThis.__pulse;
      const global = pulse._private.global;
      const config = pulse._private.global.config;
      Vue.mixin({
        beforeCreate() {
          // bind root properties
          Object.keys(global.contextRef).forEach(moduleInstance => {
            this['$' + moduleInstance] = global.contextRef[moduleInstance];
          });
          if (pulse.utils) this.$utils = pulse.utils;
          if (pulse.services) this.$services = pulse.services;

          // register component with Pulse
          global.subs.registerComponent(this);

          // alias map
          const mapData = global.subs.mapData.bind(pulse._private.global.subs);

          this.mapData = properties => mapData(properties, this);
        },
        mounted() {
          if (this.__pulseUniqueIdentifier && config.waitForMount)
            pulse.mount(this);
        },
        beforeDestroy() {
          if (this.__pulseUniqueIdentifier && config.autoUnmount)
            global.subs.untrack(this);
        }
      });
    };
  },
  updateMethod(componentInstance: any, updatedData: Object) {
    return () => {
      for (let dataKey in updatedData) {
        componentInstance.$set(
          componentInstance,
          dataKey,
          updatedData[dataKey]
        );
      }
    };
  }
};
