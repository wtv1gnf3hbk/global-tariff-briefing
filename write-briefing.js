#!/usr/bin/env node
/**
 * Calls Claude API to write a conversational tariff/trade briefing from briefing.json
 * Outputs briefing.md (markdown) and index.html (styled page)
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */

const https = require('https');
const fs = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

// ============================================
// CLAUDE API CALL
// ============================================

function callClaude(prompt, systemPrompt = '') {
  return new Promise((resolve, reject) => {
    const messages = [{ role: 'user', content: prompt }];

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: systemPrompt,
      messages
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.content[0].text);
        } catch (e) {
          reject(new Error('Failed to parse API response: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(body);
    req.end();
  });
}

// ============================================
// TIMEZONE UTILITIES
// ============================================

function formatTimestamp(timezone = 'America/New_York') {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: timezone
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone
  });
  const tzAbbr = now.toLocaleTimeString('en-US', {
    timeZone: timezone, timeZoneName: 'short'
  }).split(' ').pop();

  return { dateStr, timeStr, tzAbbr, full: `${dateStr} at ${timeStr} ${tzAbbr}` };
}

// ============================================
// HTML GENERATION
// ============================================

function generateHTML(briefingText, config) {
  const timezone = config.metadata?.timezone || 'America/New_York';
  const timestamp = formatTimestamp(timezone);
  const title = config.metadata?.name || 'Global Tariff Briefing';
  const screenshots = config.screenshots || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      line-height: 1.7;
      max-width: 680px;
      margin: 0 auto;
      padding: 32px 16px;
      background: #fafafa;
      color: #1a1a1a;
    }
    .header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e0e0e0; }
    .title {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 1.5rem; font-weight: 700; margin-bottom: 8px;
    }
    .timestamp { font-size: 0.85rem; color: #666; }
    .refresh-link { color: #666; text-decoration: underline; cursor: pointer; }
    h1, h2, strong { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    p { margin-bottom: 16px; }
    ul { margin: 12px 0 20px 0; padding-left: 0; list-style: none; }
    li { margin-bottom: 10px; padding-left: 16px; position: relative; }
    li::before { content: "\\2022"; position: absolute; left: 0; color: #999; }
    a { color: #1a1a1a; text-decoration: underline; text-decoration-color: #999; text-underline-offset: 2px; }
    a:hover { text-decoration-color: #333; }
    strong { font-weight: 600; }
    .section-header { margin-top: 24px; margin-bottom: 12px; }
    .screenshots-section { margin-top: 40px; padding-top: 24px; border-top: 1px solid #e0e0e0; }
    .screenshots-header {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 1.1rem; font-weight: 600; margin-bottom: 16px;
    }
    .screenshots-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .screenshot-card { border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: white; }
    .screenshot-card img { width: 100%; height: auto; display: block; }
    .screenshot-card .label {
      padding: 8px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.85rem; background: #f5f5f5; border-top: 1px solid #e0e0e0;
    }
    .screenshot-card .label a { color: #666; text-decoration: none; }
    .screenshot-card .label a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${title}</div>
    <div class="timestamp">
      Generated ${timestamp.full}
      &middot; <a class="refresh-link" onclick="refreshBriefing()">Refresh</a>
    </div>
  </div>

  <script>
    const WORKER_URL = 'https://global-tariff-briefing-refresh.adampasick.workers.dev';

    async function refreshBriefing() {
      const link = event.target;
      const originalText = link.textContent;
      try {
        link.textContent = 'Triggering...';
        const triggerRes = await fetch(WORKER_URL + '/trigger', { method: 'POST' });
        if (!triggerRes.ok) throw new Error('Failed to trigger');

        link.textContent = 'Starting...';
        await new Promise(r => setTimeout(r, 3000));

        const runsRes = await fetch(WORKER_URL + '/runs');
        const runsData = await runsRes.json();
        if (!runsData.workflow_runs?.length) throw new Error('No runs found');

        const runId = runsData.workflow_runs[0].id;
        const runUrl = runsData.workflow_runs[0].html_url;

        let attempts = 0;
        while (attempts < 60) {
          const statusRes = await fetch(WORKER_URL + '/status/' + runId);
          const statusData = await statusRes.json();
          if (statusData.status === 'completed') {
            if (statusData.conclusion === 'success') {
              link.textContent = 'Done! Reloading...';
              await new Promise(r => setTimeout(r, 5000));
              location.reload(true);
              return;
            } else {
              link.innerHTML = 'Failed (<a href="' + runUrl + '" target="_blank">logs</a>)';
              return;
            }
          }
          link.textContent = 'Running... ' + (attempts * 5) + 's';
          await new Promise(r => setTimeout(r, 5000));
          attempts++;
        }
        link.innerHTML = 'Timeout (<a href="' + runUrl + '" target="_blank">check</a>)';
      } catch (error) {
        console.error('Refresh error:', error);
        link.textContent = 'Error';
        setTimeout(() => { link.textContent = originalText; }, 3000);
      }
    }
  </script>

  <div id="content">
${briefingText
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  .replace(/^- (.+)$/gm, '<li>$1</li>')
  .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  .split('\n')
  .map(line => {
    if (line.startsWith('<ul>') || line.startsWith('<li>') || line.startsWith('</ul>')) return line;
    if (line.startsWith('<strong>')) return '<p class="section-header">' + line + '</p>';
    if (line.trim() && !line.startsWith('<')) return '<p>' + line + '</p>';
    return line;
  })
  .join('\n')}
  </div>

  ${screenshots.length > 0 ? '<div class="screenshots-section"><div class="screenshots-header">Homepage Screenshots</div><div class="screenshots-grid">' + screenshots.map(s => '<div class="screenshot-card"><a href="' + s.url + '" target="_blank"><img src="screenshots/' + s.filename + '" alt="' + s.name + '" loading="lazy"></a><div class="label"><a href="' + s.url + '" target="_blank">' + s.name + '</a></div></div>').join('') + '</div></div>' : ''}
</body>
</html>`;
}

// ============================================
// PROMPT BUILDING
// ============================================

function buildPrompt(briefing) {
  const config = briefing.metadata || {};
  const timezone = config.timezone || 'America/New_York';

  // Get current hour in target timezone for greeting
  const hour = new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
  const hourNum = parseInt(hour);

  let greeting;
  if (hourNum >= 5 && hourNum < 12) greeting = 'Good morning.';
  else if (hourNum >= 12 && hourNum < 17) greeting = 'Good afternoon.';
  else if (hourNum >= 17 && hourNum < 21) greeting = 'Good evening.';
  else greeting = "Here's your tariff briefing.";

  // Organize stories
  const stories = briefing.stories || {};
  const byCategory = stories.byCategory || {};
  const byPriority = stories.byPriority || {};

  const condensed = {
    primary: (byPriority.primary || []).slice(0, 8),
    secondary: (byPriority.secondary || []).slice(0, 10),
    trade: (byCategory.trade || []).slice(0, 8),
    business: (byCategory.business || []).slice(0, 5),
    regional: (byCategory.regional || []).slice(0, 5),
    government: (byCategory.government || []).slice(0, 5),
    general: (byCategory.general || []).slice(0, 5)
  };

  const screenshots = briefing.screenshots || [];

  const systemPrompt = `You are writing a tariff and trade policy briefing for NYT colleagues.

Your job is to synthesize scraped headlines into a focused, readable briefing about global tariffs, trade policy, and their economic consequences.

CRITICAL RULES:
1. NEVER use the word "amid" - find a better way to connect ideas.
2. Link text must be MAX 3 WORDS.
   - GOOD: "EU [imposed tariffs](url) on Chinese EVs"
   - BAD: "[European Union announces new tariff on electric vehicles](url)"
3. NEVER use 's as a contraction for "is" or "has" - only use 's for possessives.
   - BAD: "China's retaliating" -> GOOD: "China is retaliating"
   - OK: "China's tariff policy" (possessive)
4. Write in full sentences, not headline fragments.
5. Be conversational, like chatting with a well-informed colleague.
6. NEVER use em-dashes to join independent clauses. Write separate sentences.

TRADE-SPECIFIC RULES:
7. Always include tariff rates and percentages when available (e.g., "25% tariff on steel" not "new tariff on steel").
8. Name the affected countries AND sectors (e.g., "EU tariffs on Chinese EV imports" not just "new EU tariffs").
9. Flag retaliatory measures explicitly: who retaliated, against what, and with what rate.
10. Include dollar amounts for trade volumes when available.
11. No editorializing - report tariff actions factually, not their political "significance."`;

  const userPrompt = `${greeting} Here's what's happening in tariffs and trade:

Write a focused trade/tariff briefing using this headline data. Use ONLY these sections in this order:

1. **Top Developments** (2-3 paragraphs, no header): The biggest tariff/trade stories. Lead with the most consequential action (new tariff, retaliation, deal, ruling). Include rates, countries, and sectors.

2. **Tariff Actions & Retaliation** (3-5 bullets): Specific tariff announcements, rate changes, retaliatory measures. Each bullet must include: who, what product/sector, what rate, effective when (if known).

3. **Trade Negotiations & Diplomacy** (2-3 bullets): Trade talks, bilateral meetings, WTO rulings, trade agreements. Skip if nothing notable.

4. **Market & Economic Impact** (2-3 bullets): How tariffs are affecting markets, supply chains, prices. Include specific numbers.

5. **Sources** (bulleted list with links): List key sources cited with URLs.

Every bullet must have at least one link. Vary attribution.

Here's the data:

PRIMARY STORIES (lead with these):
${JSON.stringify(condensed.primary, null, 2)}

TRADE-SPECIFIC:
${JSON.stringify(condensed.trade, null, 2)}

BUSINESS/MARKETS:
${JSON.stringify(condensed.business, null, 2)}

SECONDARY STORIES:
${JSON.stringify(condensed.secondary, null, 2)}

REGIONAL:
${JSON.stringify(condensed.regional, null, 2)}

GOVERNMENT/OFFICIAL:
${JSON.stringify(condensed.government, null, 2)}

GENERAL:
${JSON.stringify(condensed.general, null, 2)}

${screenshots.length > 0 ? `HOMEPAGE SCREENSHOTS CAPTURED:
${screenshots.map(s => '- ' + s.name + ': screenshots/' + s.filename).join('\n')}` : ''}

Write the briefing now. Focus on tariff/trade stories. Skip non-trade news unless it directly affects trade policy.`;

  return { systemPrompt, userPrompt };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('Reading briefing.json...');

  if (!fs.existsSync('briefing.json')) {
    console.error('briefing.json not found. Run generate-briefing.js first.');
    process.exit(1);
  }

  const briefing = JSON.parse(fs.readFileSync('briefing.json', 'utf8'));
  console.log(`Found ${briefing.stats?.totalStories || 0} stories\n`);

  const { systemPrompt, userPrompt } = buildPrompt(briefing);
  console.log('Calling Claude API...');
  const startTime = Date.now();

  try {
    const briefingText = await callClaude(userPrompt, systemPrompt);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Claude responded in ${elapsed}s`);

    fs.writeFileSync('briefing.md', briefingText);
    console.log('Saved briefing.md');

    const htmlContent = generateHTML(briefingText, briefing);
    fs.writeFileSync('index.html', htmlContent);
    console.log('Saved index.html');

    console.log('\n✅ Briefing written successfully');
  } catch (e) {
    console.error('❌ Failed to write briefing:', e.message);
    process.exit(1);
  }
}

main();
