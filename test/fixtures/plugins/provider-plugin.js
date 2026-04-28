export default {
  name: 'provider-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',
  register(scope, ctx) {
    ctx.registerService('svc', { ok: true });
    scope.get('/provides', async () => ({ ok: true }));
  },
};

