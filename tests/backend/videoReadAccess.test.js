const assert = require('node:assert/strict');
const test = require('node:test');
const { canReadVideo, applyReporterVideoScope } = require('../../backend/utils/videoReadAccess');

test('Reporter reads own uploads/authored finals or approved archive, not foreign raw', () => {
  const user = { id: 'reporter-1', role: 'Reporter' };
  const foreign = { uploader: 'reporter-2', reporter: 'reporter-2', status: 'raw', processingStatus: 'completed' };
  assert.equal(canReadVideo(user, foreign), false);
  assert.equal(canReadVideo(user, { ...foreign, uploader: { _id: user.id } }), true);
  assert.equal(canReadVideo(user, { ...foreign, uploader: 'editor-1', reporter: user.id, status: 'edited', finalApprovalStatus: 'pending' }), true);
  const archive = { ...foreign, status: 'edited', processingStatus: 'completed', broadcastStatus: 'approved_for_air', qcStatus: 'passed' };
  assert.equal(canReadVideo(user, archive), true);
  assert.equal(canReadVideo(user, { ...archive, processingStatus: 'failed' }), false);
  assert.equal(canReadVideo(user, { ...archive, qcStatus: 'pending' }), false);
  assert.equal(canReadVideo({ id: 'editor', role: 'Editor' }, foreign), true);
  const filter = { $or: [{ event: 'existing search' }], uploader: 'requested other user' };
  applyReporterVideoScope(filter, user, 'station');
  assert.equal(filter.$or[0].event, 'existing search');
  assert.equal(filter.$and[0].$or.length, 3);
});
