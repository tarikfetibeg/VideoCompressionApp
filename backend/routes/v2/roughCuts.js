const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');
const authenticateToken = require('../../middleware/authenticateToken');
const EditJob = require('../../models/EditJob');
const RoughCut = require('../../models/RoughCut');
const Video = require('../../models/Video');
const AuditLog = require('../../models/AuditLog');
const { enqueueDomainEvent } = require('../../services/domainEventService');

const router = express.Router({ mergeParams: true });
router.use(authenticateToken);

const itemSchema = z.object({
  videoId: z.string().min(1),
  inMs: z.number().int().min(0),
  outMs: z.number().int().positive(),
  order: z.number().int().min(0),
  note: z.string().max(1000).default(''),
});

const updateSchema = z.object({
  version: z.number().int().min(0),
  items: z.array(itemSchema).max(200),
});

const submitSchema = z.object({
  version: z.number().int().positive(),
});

function idOf(value) {
  if (!value) return '';
  return String(value._id || value);
}

function canView(user, job) {
  if (!user || !job) return false;
  if (['Admin', 'Producer'].includes(user.role)) return true;
  if (user.role === 'Reporter') return idOf(job.reporter) === user.id;
  if (['Editor', 'VideoEditor'].includes(user.role)) {
    return idOf(job.assignedEditor) === user.id;
  }
  return false;
}

function canEdit(user, job) {
  return user?.role === 'Admin'
    || (user?.role === 'Reporter' && idOf(job.reporter) === user.id);
}

function serialize(roughCut) {
  if (!roughCut) return null;
  return {
    id: roughCut._id,
    jobId: roughCut.job,
    version: roughCut.version,
    status: roughCut.status,
    durationMs: roughCut.durationMs,
    items: (roughCut.items || []).map((item) => ({
      id: item._id,
      videoId: idOf(item.video),
      video: item.video && item.video._id ? item.video : undefined,
      inMs: item.inMs,
      outMs: item.outMs,
      order: item.order,
      note: item.note || '',
    })),
    createdBy: roughCut.createdBy,
    updatedBy: roughCut.updatedBy,
    submittedAt: roughCut.submittedAt,
    createdAt: roughCut.createdAt,
    updatedAt: roughCut.updatedAt,
  };
}

async function findJob(jobId) {
  if (!mongoose.Types.ObjectId.isValid(jobId)) return null;
  return EditJob.findById(jobId)
    .select('title reporter assignedEditor segments status workspaceState')
    .lean();
}

async function latestForJob(jobId) {
  return RoughCut.findOne({ job: jobId })
    .sort({ version: -1 })
    .populate('items.video', 'filename originalFilename event location duration processingStatus')
    .populate('createdBy updatedBy', 'username role');
}

async function validateItems(job, items) {
  const segmentVideoIds = new Set((job.segments || []).map((segment) => idOf(segment.video)));
  const requestedIds = [...new Set(items.map((item) => item.videoId))];

  if (requestedIds.some((id) => !mongoose.Types.ObjectId.isValid(id) || !segmentVideoIds.has(id))) {
    const error = new Error('Storyboard može sadržavati samo klipove koji pripadaju ovom jobu.');
    error.statusCode = 400;
    throw error;
  }

  const videos = await Video.find({ _id: { $in: requestedIds } })
    .select('_id duration')
    .lean();
  const durations = new Map(videos.map((video) => {
    const durationMs = Math.round(Number(video.duration || 0) * 1000);
    return [idOf(video), durationMs > 0 ? durationMs : null];
  }));

  return items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, index) => {
      if (!durations.has(item.videoId)) {
        const error = new Error('Jedan od odabranih klipova više nije dostupan.');
        error.statusCode = 400;
        throw error;
      }
      const durationMs = durations.get(item.videoId) || item.outMs;
      if (item.inMs >= item.outMs || item.outMs > durationMs) {
        const error = new Error('IN/OUT tačke moraju biti unutar trajanja klipa.');
        error.statusCode = 400;
        throw error;
      }
      return {
        video: item.videoId,
        inMs: item.inMs,
        outMs: item.outMs,
        order: index,
        note: item.note.trim(),
      };
    });
}

router.get('/:jobId/rough-cut', async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job nije pronađen.' });
    if (!canView(req.user, job)) return res.status(403).json({ message: 'Nemaš pristup ovom Storyboardu.' });

    const roughCut = await latestForJob(job._id);
    return res.json({
      roughCut: serialize(roughCut),
      permissions: {
        view: true,
        edit: canEdit(req.user, job) && roughCut?.status !== 'locked',
        submit: canEdit(req.user, job) && roughCut?.status !== 'locked',
      },
    });
  } catch (error) {
    console.error('Rough cut load failed:', error);
    return res.status(500).json({ message: 'Storyboard se ne može učitati.' });
  }
});

router.put('/:jobId/rough-cut', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Storyboard podaci nisu ispravni.' });

  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job nije pronađen.' });
    if (!canEdit(req.user, job)) return res.status(403).json({ message: 'Storyboard može mijenjati reporter ovog joba.' });

    const current = await RoughCut.findOne({ job: job._id }).sort({ version: -1 });
    const currentVersion = current?.version || 0;
    if (parsed.data.version !== currentVersion) {
      return res.status(409).json({
        message: 'Storyboard je u međuvremenu promijenjen. Učitaj noviju verziju prije nastavka.',
        currentVersion,
      });
    }
    if (current?.status === 'locked') {
      return res.status(409).json({ message: 'Storyboard je zaključan i više se ne može mijenjati.' });
    }

    const items = await validateItems(job, parsed.data.items);
    const durationMs = items.reduce((sum, item) => sum + (item.outMs - item.inMs), 0);
    const nextVersion = currentVersion + 1;
    let next;
    try {
      next = await RoughCut.create({
        job: job._id,
        version: nextVersion,
        status: 'draft',
        items,
        durationMs,
        createdBy: current?.createdBy || req.user.id,
        updatedBy: req.user.id,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          message: 'Storyboard je upravo sačuvan na drugom uređaju. Učitaj novu verziju.',
        });
      }
      throw error;
    }

    if (current) {
      current.status = 'superseded';
      await current.save();
    }

    await AuditLog.create({
      action: 'Save Rough Cut',
      performedBy: req.user.id,
      details: { jobId: job._id, version: nextVersion, itemCount: items.length, durationMs },
    });

    const populated = await latestForJob(job._id);
    return res.json({ message: 'Storyboard je sačuvan.', roughCut: serialize(populated) });
  } catch (error) {
    console.error('Rough cut save failed:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Storyboard se ne može sačuvati.' });
  }
});

router.post('/:jobId/rough-cut/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Verzija Storyboarda nije ispravna.' });

  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job nije pronađen.' });
    if (!canEdit(req.user, job)) return res.status(403).json({ message: 'Nemaš pravo poslati ovaj Storyboard.' });

    const roughCut = await RoughCut.findOneAndUpdate(
      { job: job._id, version: parsed.data.version, status: 'draft' },
      { $set: { status: 'submitted', submittedAt: new Date(), updatedBy: req.user.id } },
      { new: true }
    );
    if (!roughCut) {
      const latest = await RoughCut.findOne({ job: job._id }).sort({ version: -1 }).select('version status');
      return res.status(409).json({
        message: 'Pošalji najnoviju draft verziju Storyboarda.',
        currentVersion: latest?.version || 0,
        currentStatus: latest?.status || null,
      });
    }

    await enqueueDomainEvent({
      type: 'rough_cut.submitted',
      severity: 'action_required',
      actor: req.user.id,
      recipients: job.assignedEditor ? [job.assignedEditor] : [],
      recipientRoles: job.assignedEditor ? [] : ['Producer'],
      entityType: 'edit_job',
      entityId: job._id,
      entityVersion: roughCut.version,
      title: 'Novi Storyboard za montažu',
      bodyPreview: `${job.title}: reporter je poslao prijedlog redoslijeda i rezova.`,
      deepLink: `vca://job/${job._id}?view=storyboard`,
      payload: { jobId: idOf(job._id), roughCutVersion: roughCut.version },
      dedupeKey: `rough-cut-submitted:${roughCut._id}`,
    });

    await AuditLog.create({
      action: 'Submit Rough Cut',
      performedBy: req.user.id,
      details: { jobId: job._id, version: roughCut.version },
    });

    const populated = await latestForJob(job._id);
    return res.json({ message: 'Storyboard je poslan montaži.', roughCut: serialize(populated) });
  } catch (error) {
    console.error('Rough cut submit failed:', error);
    return res.status(500).json({ message: 'Storyboard se ne može poslati montaži.' });
  }
});

module.exports = router;
