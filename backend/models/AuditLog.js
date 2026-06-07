const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true },    //Ovo polje opisuje koju je tačno akciju korisnik izvršio 
                                              //(na primjer: „Reset User Password“, „Delete Video“, „Update FFmpeg Settings“ i slično).
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  details: { type: mongoose.Schema.Types.Mixed },  //Ovo polje može da sadrži bilo kakve dodatne informacije o izvedenoj radnji 
                                                  //(npr. koji fajlovi su obrisani, stare i nove vrijeddnosti prilikom ažuriranja, i slično).
  timestamp: { type: Date, default: Date.now }    //Vrijeme i datum zabilježene radnje
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
