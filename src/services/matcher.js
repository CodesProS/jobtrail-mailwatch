// src/services/matcher.js — score a classified email against JobTrail applications

const SUFFIXES = /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|limited|corp|corp\.|corporation|co|co\.|gmbh|plc|sa|ag|nv|bv|group|holdings|technologies|technology|labs|software)\b/g;
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'greenhouse.io', 'us.greenhouse-mail.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co',
  'ashbyhq.com', 'myworkday.com', 'myworkdayjobs.com', 'icims.com', 'smartrecruiters.com',
  'workablemail.com', 'workable.com', 'bamboohr.com', 'jobvite.com', 'taleo.net',
  'linkedin.com', 'indeedemail.com', 'indeed.com', 'joinhandshake.com', 'notifications.workday.com',
]);

function normCompany(s = '') {
  return s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,/#!$%^*;:{}=\-_`~()'"]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s = '') {
  return new Set(normCompany(s).split(' ').filter((t) => t.length > 1));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function domainRoot(host = '') {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function hostFromUrl(url = '') {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// job: { id, company, role, link, status }
// email: { company, role, fromDomain }
function scoreJob(job, email) {
  const ec = normCompany(email.company);
  const jc = normCompany(job.company);
  let company = 0;

  if (ec && jc) {
    if (ec === jc) company = 1;
    else if (ec.includes(jc) || jc.includes(ec)) company = 0.8;
    else company = jaccard(tokens(email.company), tokens(job.company));
  }

  // Sender-domain signal: compare email domain to the job link's domain.
  let domainBonus = 0;
  const emailRoot = domainRoot(email.fromDomain || '');
  const jobRoot = domainRoot(hostFromUrl(job.link || ''));
  if (emailRoot && !GENERIC_DOMAINS.has(email.fromDomain) && jobRoot && emailRoot === jobRoot) {
    domainBonus = 0.35;
  } else if (emailRoot && !GENERIC_DOMAINS.has(email.fromDomain) && jc) {
    // domain label vs company name, e.g. "stripe.com" ~ "Stripe"
    const label = emailRoot.split('.')[0];
    if (jc.replace(/\s+/g, '').includes(label) || label.includes(jc.replace(/\s+/g, ''))) {
      domainBonus = 0.25;
    }
  }

  // Role signal (small weight — titles vary a lot between board and email).
  let role = 0;
  if (email.role && job.role) {
    role = jaccard(
      new Set(email.role.toLowerCase().split(/\W+/).filter((t) => t.length > 2)),
      new Set(job.role.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
    );
  }

  const score = Math.min(1, company * 0.7 + domainBonus + role * 0.15);
  return { score, company, domainBonus, role };
}

// Returns { best, margin, candidates:[{id,label,score,status}] }
export function matchEmailToJobs(email, jobs) {
  const scored = jobs
    .map((job) => {
      const s = scoreJob(job, email);
      return {
        id: job.id,
        label: `${job.company} — ${job.role}`,
        status: job.status,
        score: Number(s.score.toFixed(3)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  const margin = scored.length > 1 ? Number((scored[0].score - scored[1].score).toFixed(3)) : (best ? best.score : 0);

  return { best, margin, candidates: scored.slice(0, 6) };
}
