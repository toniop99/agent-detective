export default {
  name: 'consumer-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',
  dependsOn: ['provider-plugin'],
  register(_scope, ctx) {
    // If provider-plugin didn't run first, this throws and the consumer plugin
    // will not be marked loaded by the host.
    ctx.getService('svc');
  },
};

