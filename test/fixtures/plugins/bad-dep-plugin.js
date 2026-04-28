export default {
  name: 'bad-dep-plugin',
  version: '1.0.0',
  schemaVersion: '1.0',
  dependsOn: ['missing-plugin'],
  register() {},
};

