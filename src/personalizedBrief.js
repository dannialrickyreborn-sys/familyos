const { queryDatabase } = require('./notion');
const { getConfig } = require('./config');
const { notifyMember } = require('./notifications/engine');

const DEFAULT_FAMILY_DB = '4b2708d9-b670-46b4-8b5f-d8f33602ce30';

const THEMES = [
  ['Weekly Reset', 'Mulai hari dengan satu prioritas yang jelas.', 'Pilih satu hal penting yang ingin selesai hari ini.', 'Kemajuan tidak harus besar; yang penting nyata.'],
  ['Energy', 'Energi yang stabil membantu kita berpikir dan bertindak lebih baik.', 'Pilih satu kebiasaan kecil yang membuat tubuh lebih siap menjalani hari.', 'Rawat energi sebelum menuntut performa.'],
  ['Learning', 'Wawasan bertambah ketika kita rutin bertanya dan mencoba.', 'Pelajari satu hal baru dan simpan satu pelajaran yang berguna.', 'Rasa ingin tahu adalah investasi jangka panjang.'],
  ['Focus', 'Perhatian adalah sumber daya terbatas.', 'Kerjakan satu tugas penting tanpa distraksi selama 20 menit.', 'Sedikit fokus yang konsisten mengalahkan banyak rencana yang tidak dijalankan.'],
  ['Connection', 'Hubungan yang baik dibangun dari perhatian kecil yang konsisten.', 'Berikan satu apresiasi tulus kepada anggota keluarga hari ini.', 'Kehadiranmu punya nilai bagi orang lain.'],
  ['Growth', 'Pertumbuhan datang dari refleksi dan tindakan.', 'Catat satu hal yang berhasil dan satu hal yang ingin diperbaiki.', 'Kamu tidak perlu sempurna untuk terus berkembang.'],
  ['Reflection', 'Refleksi membuat kemajuan yang samar menjadi terlihat.', 'Sebutkan satu hal yang kamu syukuri dan satu langkah berikutnya.', 'Tetap bergerak. Hari baru adalah kesempatan baru.'],
];

function prop(page, name) {
  const p = page?.properties?.[name];
  if (!p) return null;
  if (p.type === 'title') return p.title?.map(x => x.plain_text || x.text?.content || '').join('') || '';
  if (p.type === 'rich_text') return p.rich_text?.map(x => x.plain_text || x.text?.content || '').join('') || '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'checkbox') return !!p.checkbox;
  if (p.type === 'phone_number') return p.phone_number || '';
  return null;
}

function normalizePhone(value) {
  if (!value) return '';
  const s = String(value).replace(/[^0-9+]/g, '');
  if (s.startsWith('08')) return `+62${s.slice(1)}`;
  return s.startsWith('+') ? s : `+${s}`;
}

function buildMessage(member, dayIndex) {
  const [theme, insight, action, booster] = THEMES[dayIndex];
  const profile = member.profile;
  if (profile === 'SPOUSE') {
    return `🌤️ Daily Brief — ${member.name}\nTema: ${theme}\n\n${insight}\n\nPraktik hari ini: ${action}\n\n${booster}\n\nPertanyaan: Apa satu hal kecil yang bisa membuat hari ini terasa lebih ringan?`;
  }
  if (profile === 'CHILD_1' || profile === 'CHILD_2') {
    return `🌱 Daily Brief — ${member.name}\nTema: ${theme}\n\n${insight}\n\nCoba hari ini: ${action}\n\n${booster}`;
  }
  return `👨‍👩‍👧‍👦 Family Daily Brief\nTema: ${theme}\n\n${insight}\n\nPraktik hari ini: ${action}\n\n${booster}\n\nPertanyaan keluarga: Apa satu hal baik yang ingin kita lakukan hari ini?`;
}

async function loadMembers(config) {
  const db = process.env.NOTION_DB_FAMILY_MEMBERS || DEFAULT_FAMILY_DB;
  const result = await queryDatabase(config.notionToken, db, { page_size: 100 });
  return (result.results || []).map(page => ({
    id: page.id.replace(/-/g, '').slice(0, 20),
    name: prop(page, 'Name') || '',
    active: prop(page, 'Active') === true,
    whatsappAvailable: prop(page, 'WhatsApp Available') === true,
    recipient: prop(page, 'WhatsApp Recipient') || '',
    phone: normalizePhone(prop(page, 'Phone') || prop(page, 'WhatsApp Recipient')),
    profile: prop(page, 'Content Profile') || 'FAMILY',
    fallback: prop(page, 'Fallback Recipient') || '',
    role: prop(page, 'Role') || 'Other',
  })).filter(m => m.name);
}

async function runPersonalizedBrief() {
  const config = getConfig();
  if (!config.notionToken) throw new Error('NOTION_TOKEN is not set.');
  const members = await loadMembers(config);
  const byName = new Map(members.map(m => [m.name.toLowerCase(), m]));
  const dayIndex = new Date().getDay();
  const results = [];

  for (const member of members.filter(m => m.active)) {
    let target = member;
    if (!member.whatsappAvailable) {
      if (!member.fallback) {
        results.push({ memberId: member.id, ok: false, skipped: false, detail: 'Missing fallback recipient.' });
        continue;
      }
      target = byName.get(member.fallback.toLowerCase());
      if (!target || !target.active || !target.whatsappAvailable) {
        results.push({ memberId: member.id, ok: false, skipped: false, detail: 'Configured fallback is unavailable.' });
        continue;
      }
    }

    if (!target.phone || !/^\+?\d{10,15}$/.test(target.phone)) {
      results.push({ memberId: member.id, ok: false, skipped: false, detail: 'No valid WhatsApp recipient.' });
      continue;
    }

    const deliveryMember = { ...target, id: member.id, name: member.name };
    results.push(await notifyMember(member.id, buildMessage(member, dayIndex), {
      family: { members: [deliveryMember] },
    }));
  }

  const sent = results.filter(r => r.ok && !r.skipped).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`Personalized Daily Brief: ${sent} sent, ${failed} failed, ${results.length} processed.`);
  results.forEach(r => console.log(r.ok ? `PASS ${r.memberId}` : `FAIL ${r.memberId}: ${r.detail}`));
  if (failed) process.exitCode = 1;
}

module.exports = { runPersonalizedBrief, buildMessage, loadMembers };
