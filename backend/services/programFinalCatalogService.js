const BroadcastProgram = require('../models/BroadcastProgram');
const ProductionRole = require('../models/ProductionRole');
const ProgramType = require('../models/ProgramType');
const { slugify } = require('../utils/programFinals');

const DEFAULT_ROLES = [
  ['Voditelj', 'voditelj', 'editorial', 10],
  ['Producent', 'producent', 'editorial', 20],
  ['Realizator', 'realizator', 'studio', 30],
  ['Režija', 'rezija', 'studio', 40],
  ['Kamera', 'kamera', 'technical', 50],
  ['Ton', 'ton', 'technical', 60],
  ['Rasvjeta', 'rasvjeta', 'technical', 70],
  ['Grafika', 'grafika', 'postproduction', 80],
  ['Montaža', 'montaza', 'postproduction', 90],
];

async function ensureProgramFinalDefaults() {
  const roles = [];
  for (const [name, slug, group, order] of DEFAULT_ROLES) {
    roles.push(await ProductionRole.findOneAndUpdate(
      { slug },
      { $setOnInsert: { name, slug, group, order, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ));
  }
  const uncategorized = await ProgramType.findOneAndUpdate(
    { slug: 'nekategorisano' },
    {
      $setOnInsert: {
        name: 'Nekategorisano',
        slug: 'nekategorisano',
        description: 'Privremena klasifikacija za postojeće emisije.',
        recommendedRoles: [],
        active: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { roles, uncategorized };
}

async function ensureBroadcastProgramSlugs({ applyProgramType = false } = {}) {
  const { uncategorized } = await ensureProgramFinalDefaults();
  const programs = await BroadcastProgram.find({});
  let updated = 0;
  for (const program of programs) {
    let changed = false;
    if (!program.slug) {
      let candidate = slugify(program.name, `program-${program._id}`);
      let suffix = 2;
      while (await BroadcastProgram.exists({ slug: candidate, _id: { $ne: program._id } })) {
        candidate = `${slugify(program.name)}-${suffix}`;
        suffix += 1;
      }
      program.slug = candidate;
      changed = true;
    }
    if (applyProgramType && !program.programType) {
      program.programType = uncategorized._id;
      changed = true;
    }
    if (changed) {
      await program.save();
      updated += 1;
    }
  }
  return { total: programs.length, updated, uncategorized };
}

module.exports = {
  DEFAULT_ROLES,
  ensureBroadcastProgramSlugs,
  ensureProgramFinalDefaults,
};
