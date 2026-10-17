const assert = require('node:assert/strict');

module.exports = async (qa, f, test) => {
  await test('POLICY-preview-scope', 'Characterize raw preview visibility before changing station access policy', async () => {
    const ticket = await qa.api('Reporter2', '/api/media/tickets', 'POST', { videoId: String(f.videos[0]._id) });
    const station = await qa.api('Reporter2', '/api/videos/workspace?scope=station&limit=200');
    const rawIsListed = station.data?.items?.some((video) => video._id === String(f.videos[0]._id));
    assert.equal(ticket.status, 403); assert.equal(rawIsListed, false);
    for (const route of [`/api/videos/details/${f.videos[0]._id}`, `/api/videos/thumbnail/${f.videos[0]._id}`, `/api/videos/preview/${f.videos[0]._id}`, `/api/videos/stream/${f.videos[0]._id}`, `/api/videos/scrub-preview/${f.videos[0]._id}/manifest`, `/api/videos/scrub-preview/${f.videos[0]._id}/frame/0`, `/api/videos/${f.videos[0]._id}/timecodes`]) {
      assert.equal((await qa.api('Reporter2', route)).status, 403, route);
    }
    const legacy = await qa.api('Reporter2', '/api/videos?scope=station');
    assert.ok(!legacy.data.some((video) => video._id === String(f.videos[0]._id)));
    assert.equal((await qa.api('Reporter', '/api/media/tickets', 'POST', { videoId: String(f.videos[0]._id) })).status, 201);
    assert.equal((await qa.api('Reporter2', '/api/media/tickets', 'POST', { videoId: String(f.videos[1]._id) })).status, 201);
    const contradictory = await qa.api('Reporter2', '/api/videos/workspace?scope=station&library=archive&status=raw&processingStatus=failed&broadcastStatus=approved_for_air');
    assert.equal(contradictory.data.total, 0);
    return { policy: 'User-approved: own uploader/author or approved archive', foreignRawTicketStatus: ticket.status, stationIncludesForeignRaw: rawIsListed, legacyProtected: true };
  });
  await test('POLICY-role-revocation', 'Characterize existing JWT after Admin changes the account role', async () => {
    const name = 'qa_role_policy';
    assert.equal((await qa.api('Admin', '/api/admin/users', 'POST', { username: name, password: qa.password, role: 'Admin' })).status, 201);
    const account = await qa.models.User.findOne({ username: name });
    const login = await qa.api(null, '/api/auth/login', 'POST', { username: name, password: qa.password });
    qa.sessions.PolicyAdmin = { ...login.data.user, token: login.data.token };
    assert.equal((await qa.api('Admin', `/api/admin/users/${account._id}`, 'PUT', { username: name, role: 'Reporter' })).status, 200);
    const oldSession = await qa.api('PolicyAdmin', '/api/admin/users');
    return { status: 'blocked', acceptedRisk: true, reason: 'User deferred immediate revocation; old JWT can retain privileges for up to one hour (media tickets have their own lifetime/cache)', oldAdminTokenStatus: oldSession.status, newDatabaseRole: 'Reporter' };
  });
  await test('POLICY-linked-video-delete', 'Characterize deletion of a video that is still used by an active rundown', async () => {
    const result = await qa.api('Admin', `/api/admin/videos/${f.videos[1]._id}`, 'DELETE');
    const show = await qa.models.ShowDay.findById(f.show._id);
    const dangling = show.items.some((item) => String(item.video) === String(f.videos[1]._id)) && !(await qa.models.Video.exists({ _id: f.videos[1]._id }));
    return { status: 'blocked', acceptedRisk: true, reason: 'User requested documentation only; active-reference deletion remains an open risk', deleteStatus: result.status, leavesDanglingRundown: Boolean(dangling) };
  });
};
