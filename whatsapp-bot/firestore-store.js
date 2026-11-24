'use strict';
/* NutriViva · leitura e gravação do robô no Cloud Firestore (Firebase Admin SDK).
 * Carrega só o necessário para uma conversa, roda o robô e grava as mudanças.
 * A reserva do horário é feita numa transação: se outra pessoa reservou antes, nada é gravado. */
const PATIENT_DOMAIN = 'paciente.nutriviva.app';

function clean(x) { const o = JSON.parse(JSON.stringify(x || {})); delete o.id; delete o.password; return o; }
function stable(x) {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sort(v[k]), o), {}) : v;
  return JSON.stringify(sort(clean(x)));
}
const withId = d => ({ ...d.data(), id: d.id });
const yesterday = () => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

class SlotTaken extends Error { constructor() { super('Horário reservado por outra pessoa'); this.code = 'SLOT_TAKEN'; } }

function createStore(store, auth) {
  async function load(phone) {
    const [pros, patients, slots, cfg, chat] = await Promise.all([
      store.collection('users').where('role', '==', 'nutricionista').get(),
      store.collection('users').where('role', '==', 'paciente').where('phone', '==', phone).get(),
      store.collection('slots').where('date', '>=', yesterday()).get(),
      store.doc('config/whatsapp').get(),
      store.doc('waChats/' + phone).get(),
    ]);
    const ids = patients.docs.map(d => d.id).slice(0, 10);
    const bookings = ids.length ? (await store.collection('bookings').where('patient', 'in', ids).get()).docs.map(withId) : [];
    const data = {
      users: [...pros.docs, ...patients.docs].map(withId),
      slots: slots.docs.map(withId),
      bookings,
      whatsapp: cfg.exists ? cfg.data() : {},
      waChats: chat.exists ? [{ ...chat.data(), id: phone, phone }] : [],
    };
    const base = {};
    for (const col of ['users', 'slots', 'bookings']) base[col] = new Map(data[col].map(x => [x.id, stable(x)]));
    base.chatLength = chat.exists ? (chat.data().messages || []).length : 0;
    return { data, base };
  }

  async function createAccount({ phone, name, password }) {
    const email = phone + '@' + PATIENT_DOMAIN;
    try { return (await auth.createUser({ email, password, displayName: name })).uid; }
    catch (e) {
      if (e.code !== 'auth/email-already-exists') throw e;
      const u = await auth.getUserByEmail(email);
      await auth.updateUser(u.uid, { password, displayName: name });
      return u.uid;
    }
  }

  function mergeChat(fresh, local, loadedLength) {
    if (!fresh) return local;
    const added = (local.messages || []).slice(loadedLength);
    const messages = [...(fresh.messages || []), ...added].slice(-200);
    return { ...fresh, ...local, messages, created: fresh.created || local.created };
  }

  async function save(phone, data, base, chat) {
    const changed = col => (data[col] || []).filter(x => base[col].get(x.id) !== stable(x));
    // Novos cadastros de paciente (o login já foi criado no Firebase Authentication)
    for (const u of changed('users')) await store.doc('users/' + u.id).set(clean(u));
    const slots = changed('slots'), bookings = changed('bookings');
    await store.runTransaction(async tx => {
      const refs = slots.map(s => store.doc('slots/' + s.id));
      const snaps = refs.length ? await tx.getAll(...refs) : [];
      const chatRef = store.doc('waChats/' + phone);
      const chatSnap = await tx.get(chatRef);
      snaps.forEach((sn, i) => {
        const before = JSON.parse(base.slots.get(slots[i].id) || '{}').booking || null;
        if (!sn.exists || (sn.data().booking || null) !== before) throw new SlotTaken();
      });
      slots.forEach((s, i) => tx.set(refs[i], clean(s)));
      bookings.forEach(b => tx.set(store.doc('bookings/' + b.id), clean(b)));
      if (chat) tx.set(chatRef, mergeChat(chatSnap.exists ? chatSnap.data() : null, { ...clean(chat), phone }, base.chatLength));
    });
  }

  async function resetChat(phone) {
    await store.doc('waChats/' + phone).set({ state: { step: 'menu' }, updated: new Date().toISOString() }, { merge: true });
  }

  // Respostas da equipe (painel → waOutbox): o servidor envia e marca como enviadas.
  function watchOutbox(send, serial, onError) {
    return store.collection('waOutbox').where('sent', '==', false).onSnapshot(snap => {
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue;
        const ref = ch.doc.ref;
        serial(async () => {
          const fresh = await ref.get();
          if (!fresh.exists || fresh.data().sent) return;
          const { phone, text } = fresh.data();
          let error = '';
          try { await send(phone, String(text || '')); } catch (e) { error = String(e.message || e).slice(0, 300); }
          await ref.update({ sent: true, sentAt: new Date().toISOString(), ...(error ? { error } : {}) });
        }).catch(onError);
      }
    }, onError);
  }

  return { load, save, createAccount, resetChat, watchOutbox };
}

module.exports = { createStore, SlotTaken, PATIENT_DOMAIN };
