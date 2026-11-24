/* NutriViva · motor do atendimento automático pelo WhatsApp.
 * O mesmo arquivo roda no navegador (simulador do site) e no servidor Node (WhatsApp Cloud API).
 * await NVBot.reply(db, telefone, texto, {uid, now, hash, siteUrl}) altera o objeto db e devolve {replies, changed, chat}.
 * hash(senha) deve devolver o SHA-256 em hexadecimal (modo demonstração, login no navegador).
 * createAccount({phone, name, password}) cria o login no Firebase Authentication e devolve o id (modo Firebase).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NVBot = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_MESSAGES = 200, MAX_PROS = 9, MAX_DATES = 8, MAX_TIMES = 12, SESSION_MINUTES = 30;
  const DEFAULT_WELCOME = 'Olá! Eu sou o assistente virtual da NutriViva 🌿';
  const DEFAULT_OFF = 'Recebemos sua mensagem. Nossa equipe vai responder por aqui assim que possível.';

  const pad = n => String(n).padStart(2, '0');
  const when = s => new Date(s.date + 'T' + s.time + ':00');
  const money = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const fmt = s => dayLabel(s.date) + ' às ' + s.time;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[!?.,;]+$/g, '').trim();

  function normPhone(v) {
    let n = String(v || '').replace(/\D/g, '');
    if (n.length === 10 || n.length === 11) n = '55' + n;
    return /^[1-9]\d{7,14}$/.test(n) ? n : '';
  }
  function safeUrl(v) { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }
  const duration = (db, proId) => (db.users.find(u => u.id === proId)?.duration || 50);
  const prettyPhone = n => { const m = String(n).match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : '+' + n; };
  const findPatient = (db, phone) => db.users.find(u => u.role === 'paciente' && normPhone(u.phone) === phone) || null;
  const pros = db => db.users.filter(u => u.role === 'nutricionista');

  function freeSlots(db, proId, now) {
    return db.slots
      .filter(s => s.pro === proId && when(s) > now && !s.booking && !db.bookings.some(b => b.slot === s.id && b.status !== 'cancelada'))
      .sort((a, b) => when(a) - when(b));
  }
  // Consultas confirmadas que ainda não terminaram (inclui a que está acontecendo agora).
  function upcoming(db, patientId, now) {
    return db.bookings
      .filter(b => b.patient === patientId && b.status === 'confirmada')
      .map(b => ({ b, s: db.slots.find(s => s.id === b.slot) }))
      .filter(x => x.s && when(x.s).getTime() + duration(db, x.s.pro) * 60000 > now.getTime())
      .sort((x, y) => when(x.s) - when(y.s));
  }
  function overlaps(db, patientId, slot) {
    const start = when(slot).getTime(), end = start + duration(db, slot.pro) * 60000;
    return db.bookings.some(b => {
      if (b.patient !== patientId || b.status !== 'confirmada') return false;
      const x = db.slots.find(t => t.id === b.slot);
      if (!x) return false;
      const xs = when(x).getTime();
      return xs < end && xs + duration(db, x.pro) * 60000 > start;
    });
  }

  function menuText() {
    return ['Como posso ajudar? Responda com o *número*:', '',
      '*1* Agendar consulta', '*2* Minhas consultas', '*3* Cancelar consulta',
      '*4* Escolher nutricionista', '*5* Link da videochamada', '*6* Falar com um atendente', '',
      'A qualquer momento, envie *menu* para voltar aqui.'].join('\n');
  }
  function intent(t) {
    if (/^[1-6]$/.test(t)) return Number(t);
    if (/cancel|desmarc/.test(t)) return 3;
    if (/minhas|meus agend|minha consulta|proxima consulta/.test(t)) return 2;
    if (/link|sala|video|meet/.test(t)) return 5;
    if (/atendente|humano|pessoa|falar com/.test(t)) return 6;
    if (/agend|marcar|horario/.test(t)) return 1;
    if (/valor|preco|nutricionista|nutri|especialidade|quanto custa|escolher/.test(t)) return 4;
    return 0;
  }
  const GREETINGS = ['menu', 'inicio', 'oi', 'ola', 'oie', 'bom dia', 'boa tarde', 'boa noite', '0', 'voltar', 'comecar', 'robo'];
  const BYE = ['sair', 'encerrar', 'tchau', 'obrigado', 'obrigada', 'valeu'];
  const NOT_FOUND = 'Não encontrei um cadastro de paciente com este número de WhatsApp.\n\nSe você já tem conta no site, cadastre este número em *Minha conta*. Para agendar agora, envie *1*.';

  async function reply(db, phoneRaw, text, opts) {
    opts = opts || {};
    const now = opts.now ? opts.now() : new Date();
    const uid = opts.uid;
    const iso = now.toISOString();
    const phone = normPhone(phoneRaw);
    if (!phone) return { replies: [], changed: false, chat: null };
    db.users = db.users || []; db.slots = db.slots || []; db.bookings = db.bookings || [];
    db.waChats = Array.isArray(db.waChats) ? db.waChats : [];
    const cfg = db.whatsapp || {};
    const siteUrl = String(opts.siteUrl || cfg.siteUrl || '').trim();

    let chat = db.waChats.find(c => c.phone === phone);
    if (!chat) {
      chat = { id: uid(), phone, state: { step: 'menu' }, messages: [], handoff: false, created: iso, updated: iso };
      db.waChats.push(chat);
    }
    const firstContact = chat.messages.length === 0;
    const idle = (now - new Date(chat.updated)) / 60000 > SESSION_MINUTES;
    if (idle && !chat.handoff) chat.state = { step: 'menu' };

    const body = String(text || '').slice(0, 1000);
    // A senha digitada no cadastro nunca fica gravada no histórico da conversa.
    const secret = !chat.handoff && !idle && cfg.enabled !== false && chat.state?.step === 'askPassword';
    chat.messages.push({ from: 'user', text: secret ? '•••••••• (senha ocultada)' : body, at: iso });
    const out = [];
    const say = m => out.push(m);
    const t = norm(body);
    const patient = () => findPatient(db, phone);
    const state = chat.state || { step: 'menu' };
    const go = s => { chat.state = s; };
    const greeting = () => {
      const p = patient();
      return (cfg.welcome || DEFAULT_WELCOME) + (p ? `\n\nQue bom falar com você, *${p.name.split(' ')[0]}*.` : '') + '\n\n' + menuText();
    };
    const invalid = n => say(`Não entendi 🙂 Responda com um número de *1* a *${n}*, ou envie *menu*.`);
    const pick = list => { const n = Number(t); return Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1] : null; };

    // Agradecimento final: só depois que o paciente usa a opção 5 (link) ou conclui a opção 3 (cancelar).
    function thanks(cancelled) {
      if (!chat.pendingThanks) return;
      chat.pendingThanks = false;
      const first = (patient()?.name || '').split(' ')[0];
      say(cancelled
        ? `Obrigado pelo contato${first ? ', *' + first + '*' : ''}! 💚 Quando quiser remarcar, é só enviar *1*. Estamos aqui para cuidar de você. 🌿`
        : `Muito obrigado por agendar com a NutriViva${first ? ', *' + first + '*' : ''}! 💚\nFicamos felizes em fazer parte do seu cuidado. Até a consulta! 🌿`);
    }
    function passwordPrompt() {
      return `Agora crie uma *senha* com pelo menos 8 caracteres.\n\nNo dia da consulta, você vai entrar na plataforma com *este celular* e essa senha para acessar a videochamada.`;
    }
    function startBooking() {
      const list = pros(db).map(p => ({ p, free: freeSlots(db, p.id, now) })).filter(x => x.free.length).slice(0, MAX_PROS);
      if (!list.length) { go({ step: 'menu' }); return say('No momento não há horários disponíveis. Envie *6* para falar com um atendente.'); }
      go({ step: 'pickPro', options: list.map(x => x.p.id) });
      say('Com quem você quer agendar?\n\n' + list.map((x, i) => `*${i + 1}* ${x.p.name} — ${x.p.specialty || 'Nutrição'} · ${money(x.p.price)}`).join('\n') + '\n\nResponda com o número.');
    }
    function listPros() {
      const list = pros(db).slice(0, MAX_PROS);
      if (!list.length) { go({ step: 'menu' }); return say('Ainda não há nutricionistas cadastrados.'); }
      go({ step: 'choosePro', options: list.map(p => p.id) });
      say('Qual nutricionista você quer conhecer?\n\n' + list.map((p, i) => {
        const next = freeSlots(db, p.id, now)[0];
        return `*${i + 1}* ${p.name}\n    ${p.specialty || 'Nutrição'} · ${money(p.price)}${next ? '' : ' · sem horários no momento'}`;
      }).join('\n') + '\n\nResponda com o número.');
    }
    function showPro(proId) {
      const p = db.users.find(u => u.id === proId && u.role === 'nutricionista');
      if (!p) return listPros();
      const free = freeSlots(db, p.id, now);
      const lines = [`🩺 *${p.name}*`, `${p.specialty || 'Nutrição'}${p.crn ? ' · ' + p.crn : ''}`];
      if (p.bio) lines.push('', p.bio);
      lines.push('', `💰 ${money(p.price)} · ⏱ ${p.duration || 50} min · 💻 On-line`);
      lines.push(free.length ? `📅 Próximo horário: ${fmt(free[0])}` : '📅 Sem horários disponíveis no momento');
      lines.push('', free.length ? `*1* Agendar com ${p.name.split(' ')[0]}` : '*1* Falar com um atendente', '*2* Ver outro nutricionista');
      go({ step: 'proAction', pro: p.id, hasSlots: free.length > 0 });
      say(lines.join('\n'));
    }
    function listDates(proId) {
      const p = db.users.find(u => u.id === proId);
      const dates = [...new Set(freeSlots(db, proId, now).map(s => s.date))].slice(0, MAX_DATES);
      if (!p || !dates.length) { startBooking(); return; }
      go({ step: 'pickDate', pro: proId, options: dates });
      say(`*${p.name}* · ${money(p.price)} · ${p.duration || 50} min\n\nEscolha o dia:\n\n` + dates.map((d, i) => `*${i + 1}* ${dayLabel(d)}`).join('\n'));
    }
    function listTimes(proId, date) {
      const slots = freeSlots(db, proId, now).filter(s => s.date === date).slice(0, MAX_TIMES);
      if (!slots.length) { say('Esse dia acabou de ficar sem horários.'); return listDates(proId); }
      go({ step: 'pickTime', pro: proId, date, options: slots.map(s => s.id) });
      say(`Horários em *${dayLabel(date)}*:\n\n` + slots.map((s, i) => `*${i + 1}* ${s.time}`).join('\n') + '\n\nHorário de Brasília.');
    }
    function askConfirm(slotId) {
      const s = db.slots.find(x => x.id === slotId), p = db.users.find(u => u.id === s?.pro), pat = patient();
      if (!s || !p || !pat) return startBooking();
      go({ step: 'confirm', slot: slotId, pro: p.id, date: s.date });
      say(`Confira sua consulta:\n\n👤 ${pat.name}\n🩺 ${p.name} — ${p.specialty || 'Nutrição'}\n📅 ${fmt(s)}\n⏱ ${p.duration || 50} min · ${money(p.price)}\n💻 On-line, por videochamada\n\n*1* Confirmar\n*2* Escolher outro horário`);
    }
    function listMine(forStep) {
      const p = patient();
      if (!p) { go({ step: 'menu' }); return say(NOT_FOUND); }
      const list = upcoming(db, p.id, now);
      if (!list.length) { go({ step: 'menu' }); return say('Você não tem consultas agendadas. Envie *1* para agendar.'); }
      const lines = list.map((x, i) => {
        const pro = db.users.find(u => u.id === x.s.pro);
        return `${forStep ? `*${i + 1}* ` : '• '}${fmt(x.s)} — ${pro?.name || 'Nutricionista'}`;
      });
      if (forStep) {
        go({ step: 'pickCancel', options: list.map(x => x.b.id) });
        return say('Qual consulta você quer cancelar?\n\n' + lines.join('\n'));
      }
      go({ step: 'menu' });
      say('Suas próximas consultas:\n\n' + lines.join('\n') + '\n\nEnvie *5* para o link da videochamada ou *3* para cancelar.');
    }
    function runOption(n) {
      if (n === 1) return startBooking();
      if (n === 2) return listMine(false);
      if (n === 3) return listMine(true);
      if (n === 4) return listPros();
      if (n === 5) {
        go({ step: 'menu' });
        const p = patient();
        if (!p) return say(NOT_FOUND);
        const list = upcoming(db, p.id, now);
        if (!list.length) return say('Você não tem consultas agendadas. Envie *1* para agendar.');
        say(list.map(x => {
          const pro = db.users.find(u => u.id === x.s.pro);
          const url = x.b.room ? safeUrl(x.b.room) : safeUrl(pro?.room);
          return `📅 ${fmt(x.s)} — ${pro?.name || ''}\n${url ? '🔗 ' + url : 'O link ainda não foi disponibilizado. Ele aparece aqui assim que o nutricionista salvar a sala.'}`;
        }).join('\n\n'));
        return thanks(false);
      }
      if (n === 6) {
        go({ step: 'menu' });
        chat.handoff = true; chat.handoffAt = iso;
        return say('Certo! Vou chamar um atendente da nossa equipe, que vai responder por aqui. 🙋\n\nSe quiser voltar ao atendimento automático, envie *menu*.');
      }
    }

    // 1. Robô desativado na configuração
    if (cfg.enabled === false) {
      if (!chat.handoff) { chat.handoff = true; chat.handoffAt = iso; say(cfg.offMessage || DEFAULT_OFF); }
    }
    // 2. Conversa com atendente humano: o robô só volta com "menu"
    else if (chat.handoff) {
      if (['menu', 'robo', 'voltar', 'inicio'].includes(t)) { chat.handoff = false; go({ step: 'menu' }); say(greeting()); }
    }
    // 3. Comandos globais
    else if (GREETINGS.includes(t)) { go({ step: 'menu' }); say(greeting()); }
    else if (BYE.includes(t)) { go({ step: 'menu' }); say('Até logo! Quando precisar, é só mandar *oi*. 🌿'); }
    // 4. Etapas da conversa
    else switch (state.step) {
      case 'pickPro': { const id = pick(state.options || []); id ? listDates(id) : invalid((state.options || []).length); break; }
      case 'choosePro': { const id = pick(state.options || []); id ? showPro(id) : invalid((state.options || []).length); break; }
      case 'proAction': {
        if (t === '2' || /outro|lista/.test(t)) { listPros(); break; }
        if (!(t === '1' || /agend|marcar|sim|atendente/.test(t))) { invalid(2); break; }
        if (freeSlots(db, state.pro, now).length) listDates(state.pro); else runOption(6);
        break;
      }
      case 'pickDate': { const d = pick(state.options || []); d ? listTimes(state.pro, d) : invalid((state.options || []).length); break; }
      case 'pickTime': {
        const id = pick(state.options || []);
        if (!id) { invalid((state.options || []).length); break; }
        if (!freeSlots(db, state.pro, now).some(s => s.id === id)) { say('Esse horário acabou de ser reservado.'); listTimes(state.pro, state.date); break; }
        const known = patient();
        if (known && (known.password || opts.createAccount)) askConfirm(id);
        else if (known) { go({ step: 'askPassword', slot: id, pro: state.pro, date: state.date, name: known.name }); say(passwordPrompt()); }
        else { go({ step: 'askName', slot: id, pro: state.pro, date: state.date }); say('Você ainda não tem cadastro. Vamos criar agora, leva menos de um minuto. 🙂\n\nQual é o seu *nome completo*?'); }
        break;
      }
      case 'askName': {
        const name = body.trim().replace(/\s+/g, ' ');
        if (name.length < 3 || name.length > 100 || !/\p{L}{2,}/u.test(name) || /^\d+$/.test(name)) { say('Por favor, envie seu nome completo (ou *menu* para voltar).'); break; }
        go({ ...state, step: 'askPassword', name });
        say(passwordPrompt());
        break;
      }
      case 'askPassword': {
        const pass = body.trim();
        if (pass.length < 8 || pass.length > 64) { say('A senha precisa ter de *8 a 64 caracteres*. Envie outra senha (ou *menu* para voltar).'); break; }
        let p = patient();
        try {
          if (typeof opts.createAccount === 'function') {
            const id = await opts.createAccount({ phone, name: state.name || p?.name, password: pass });
            if (!p) { p = { id, name: state.name, email: '', role: 'paciente', phone, origin: 'whatsapp', created: iso }; db.users.push(p); }
          } else if (typeof opts.hash === 'function') {
            const passwordHash = await opts.hash(pass);
            if (p) p.password = passwordHash;
            else { p = { id: uid(), name: state.name, email: '', password: passwordHash, role: 'paciente', phone, origin: 'whatsapp', created: iso }; db.users.push(p); }
          } else throw Error('sem método de cadastro');
        } catch (e) {
          go({ step: 'menu' });
          say('Não foi possível criar o seu cadastro agora. Tente novamente em alguns minutos ou envie *6* para falar com um atendente.');
          break;
        }
        say(`Cadastro pronto, *${p.name.split(' ')[0]}*! ✅\n\nPara entrar na plataforma no dia da consulta:\n📱 Login: *${prettyPhone(phone)}* (este celular)\n🔒 Senha: a que você acabou de criar${siteUrl ? '\n🌐 ' + siteUrl : ''}\n\nPor segurança, apague a mensagem com a senha desta conversa (toque e segure → Apagar).`);
        askConfirm(state.slot);
        break;
      }
      case 'confirm': {
        if (t === '2' || /outro|trocar|nao/.test(t)) { listTimes(state.pro, state.date); break; }
        if (!(t === '1' || /^(sim|confirm|ok|pode)/.test(t))) { invalid(2); break; }
        const s = db.slots.find(x => x.id === state.slot), p = patient();
        if (!s || !p || !freeSlots(db, s.pro, now).some(x => x.id === s.id)) { say('Esse horário não está mais disponível.'); listTimes(state.pro, state.date); break; }
        if (overlaps(db, p.id, s)) { go({ step: 'menu' }); say('Você já tem uma consulta nesse período. Envie *2* para ver suas consultas.'); break; }
        const bookingId = uid();
        db.bookings.push({ id: bookingId, slot: s.id, patient: p.id, pro: s.pro, status: 'confirmada', created: iso, origin: 'whatsapp' });
        s.booking = bookingId;
        go({ step: 'menu' });
        const pro = db.users.find(u => u.id === s.pro);
        say(`Consulta agendada! ✅\n\n📅 ${fmt(s)}\n🩺 ${pro?.name || ''}\n\nNo dia, entre na plataforma com seu celular e senha${siteUrl ? ' em ' + siteUrl : ''} e clique em *Entrar na sala*. Se preferir, envie *5* aqui para receber o link da videochamada. Para cancelar, envie *3*.`);
        chat.pendingThanks = true;
        break;
      }
      case 'pickCancel': {
        const id = pick(state.options || []);
        if (!id) { invalid((state.options || []).length); break; }
        const b = db.bookings.find(x => x.id === id), s = db.slots.find(x => x.id === b?.slot);
        go({ step: 'confirmCancel', booking: id });
        say(`Cancelar a consulta de *${s ? fmt(s) : ''}*?\n\n*1* Sim, cancelar\n*2* Não, manter`);
        break;
      }
      case 'confirmCancel': {
        if (t === '2' || /^nao|manter/.test(t)) { go({ step: 'menu' }); say('Tudo certo, sua consulta foi mantida. 👍'); thanks(false); break; }
        if (!(t === '1' || /^sim|cancel/.test(t))) { invalid(2); break; }
        const p = patient(), b = db.bookings.find(x => x.id === state.booking);
        go({ step: 'menu' });
        if (!p || !b || b.patient !== p.id || b.status !== 'confirmada') { say('Não foi possível cancelar essa consulta. Envie *6* para falar com um atendente.'); break; }
        b.status = 'cancelada'; b.cancelled = iso; b.cancelledBy = 'whatsapp';
        const freed = db.slots.find(x => x.id === b.slot);
        if (freed && freed.booking === b.id) freed.booking = null;
        say('Consulta cancelada. O horário voltou para a agenda do nutricionista. Se quiser remarcar, envie *1*.');
        thanks(true);
        break;
      }
      default: {
        const n = intent(t);
        if (n) runOption(n);
        else if (firstContact || idle) say(greeting());
        else say('Desculpe, não entendi. 🙂\n\n' + menuText());
      }
    }

    for (const m of out) chat.messages.push({ from: 'bot', text: m, at: iso });
    if (chat.messages.length > MAX_MESSAGES) chat.messages = chat.messages.slice(-MAX_MESSAGES);
    chat.updated = iso;
    return { replies: out, changed: true, chat };
  }

  return { reply, normPhone, menuText };
});
