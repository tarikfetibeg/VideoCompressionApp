const express = require('express');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const ProductionPerson = require('../models/ProductionPerson');
const ProductionRole = require('../models/ProductionRole');
const ProgramType = require('../models/ProgramType');
const authenticateToken = require('../middleware/authenticateToken');
const { ensureProgramFinalDefaults } = require('../services/programFinalCatalogService');
const { normalizeText, slugify } = require('../utils/programFinals');

const router = express.Router();
const allRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];

router.use(authenticateToken);

function requireKnownRole(req, res, next) {
  if (!allRoles.includes(req.user.role)) return res.status(403).json({ message: 'Pristup nije dozvoljen.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin može mijenjati katalog.' });
  next();
}

function objectIds(values) {
  return Array.from(new Set((values || [])
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map(String)));
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function audit(req, action, details) {
  return AuditLog.create({ action, performedBy: req.user.id, details });
}

async function deactivateCatalog(req, res, Model, action, idField, notFoundMessage) {
  try {
    const item = await Model.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!item) return res.status(404).json({ message: notFoundMessage });
    await audit(req, action, { [idField]: item._id, name: item.name });
    return res.json({ item, deactivated: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

router.get('/program-types', requireKnownRole, async (_req, res) => {
  await ensureProgramFinalDefaults();
  const items = await ProgramType.find({}).populate('recommendedRoles').sort({ active: -1, name: 1 });
  res.json(items);
});

router.post('/program-types', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Naziv tipa programa je obavezan.' });
    const recommendedRoles = objectIds(req.body?.recommendedRoles);
    const existingRoles = await ProductionRole.countDocuments({ _id: { $in: recommendedRoles } });
    if (existingRoles !== recommendedRoles.length) {
      return res.status(400).json({ message: 'Jedna od preporučenih funkcija nije pronađena.' });
    }
    const item = await ProgramType.create({
      name,
      slug: slugify(req.body?.slug || name),
      description: String(req.body?.description || '').trim(),
      recommendedRoles,
      active: req.body?.active !== false,
    });
    await audit(req, 'Create Program Final Type', { programTypeId: item._id, name: item.name });
    res.status(201).json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Naziv ili slug već postoji.' : error.message });
  }
});

router.put('/program-types/:id', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Naziv tipa programa je obavezan.' });
    const recommendedRoles = objectIds(req.body?.recommendedRoles);
    const existingRoles = await ProductionRole.countDocuments({ _id: { $in: recommendedRoles } });
    if (existingRoles !== recommendedRoles.length) {
      return res.status(400).json({ message: 'Jedna od preporučenih funkcija nije pronađena.' });
    }
    const item = await ProgramType.findByIdAndUpdate(req.params.id, {
      name,
      slug: slugify(req.body?.slug || name),
      description: String(req.body?.description || '').trim(),
      recommendedRoles,
      active: req.body?.active !== false,
    }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Tip programa nije pronađen.' });
    await audit(req, 'Update Program Final Type', { programTypeId: item._id, name: item.name });
    res.json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Naziv ili slug već postoji.' : error.message });
  }
});

router.delete('/program-types/:id', requireAdmin, async (req, res) => {
  return deactivateCatalog(
    req,
    res,
    ProgramType,
    'Deactivate Program Final Type',
    'programTypeId',
    'Tip programa nije pronađen.'
  );
});

router.get('/production-roles', requireKnownRole, async (_req, res) => {
  await ensureProgramFinalDefaults();
  res.json(await ProductionRole.find({}).sort({ active: -1, order: 1, name: 1 }));
});

router.post('/production-roles', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Naziv funkcije je obavezan.' });
    const item = await ProductionRole.create({
      name,
      slug: slugify(req.body?.slug || name),
      group: req.body?.group || 'other',
      order: Math.max(Number(req.body?.order) || 100, 0),
      active: req.body?.active !== false,
    });
    await audit(req, 'Create Production Role', { productionRoleId: item._id, name: item.name });
    res.status(201).json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Funkcija već postoji.' : error.message });
  }
});

router.put('/production-roles/:id', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Naziv funkcije je obavezan.' });
    const item = await ProductionRole.findByIdAndUpdate(req.params.id, {
      name,
      slug: slugify(req.body?.slug || name),
      group: req.body?.group || 'other',
      order: Math.max(Number(req.body?.order) || 100, 0),
      active: req.body?.active !== false,
    }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Funkcija nije pronađena.' });
    await audit(req, 'Update Production Role', { productionRoleId: item._id, name: item.name });
    res.json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Funkcija već postoji.' : error.message });
  }
});

router.delete('/production-roles/:id', requireAdmin, async (req, res) => {
  return deactivateCatalog(
    req,
    res,
    ProductionRole,
    'Deactivate Production Role',
    'productionRoleId',
    'Funkcija nije pronađena.'
  );
});

router.get('/production-people', requireKnownRole, async (req, res) => {
  const query = String(req.query.q || '').trim();
  const filter = {};
  if (req.query.active === 'true') filter.active = true;
  if (query) {
    const normalized = normalizeText(query);
    filter.$or = [
      { normalizedName: { $regex: `^${escapeRegex(normalized)}` } },
      { aliases: { $regex: escapeRegex(query), $options: 'i' } },
    ];
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json(await ProductionPerson.find(filter).populate('user', 'username role').sort({ active: -1, name: 1 }).limit(limit));
});

router.post('/production-people', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Ime osobe je obavezno.' });
    const item = await ProductionPerson.create({
      name,
      normalizedName: normalizeText(name),
      aliases: Array.from(new Set((req.body?.aliases || []).map((value) => String(value).trim()).filter(Boolean))),
      user: mongoose.Types.ObjectId.isValid(req.body?.userId) ? req.body.userId : null,
      active: req.body?.active !== false,
    });
    await audit(req, 'Create Production Person', { productionPersonId: item._id, name: item.name });
    res.status(201).json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Osoba već postoji u imeniku.' : error.message });
  }
});

router.put('/production-people/:id', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Ime osobe je obavezno.' });
    const item = await ProductionPerson.findByIdAndUpdate(req.params.id, {
      name,
      normalizedName: normalizeText(name),
      aliases: Array.from(new Set((req.body?.aliases || []).map((value) => String(value).trim()).filter(Boolean))),
      user: mongoose.Types.ObjectId.isValid(req.body?.userId) ? req.body.userId : null,
      active: req.body?.active !== false,
    }, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Osoba nije pronađena.' });
    await audit(req, 'Update Production Person', { productionPersonId: item._id, name: item.name });
    res.json(item);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Osoba već postoji u imeniku.' : error.message });
  }
});

router.delete('/production-people/:id', requireAdmin, async (req, res) => {
  return deactivateCatalog(
    req,
    res,
    ProductionPerson,
    'Deactivate Production Person',
    'productionPersonId',
    'Osoba nije pronađena.'
  );
});

module.exports = router;
