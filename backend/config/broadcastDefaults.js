const defaultContentTypes = Object.freeze([
  { name: 'Prilog', slug: 'prilog', jobSlaHours: 8, jobGraceHours: 4 },
  { name: 'Insert', slug: 'insert', jobSlaHours: 4, jobGraceHours: 4 },
  { name: 'Spica', slug: 'spica', jobSlaHours: 72, jobGraceHours: 4 },
  { name: 'Promo', slug: 'promo', jobSlaHours: 48, jobGraceHours: 4 },
  { name: 'Marketing', slug: 'marketing', jobSlaHours: 72, jobGraceHours: 4 },
  { name: 'Grafika', slug: 'grafika', jobSlaHours: 72, jobGraceHours: 4 },
  { name: 'Ostalo', slug: 'ostalo', jobSlaHours: 72, jobGraceHours: 4 },
]);

module.exports = {
  defaultContentTypes,
};
