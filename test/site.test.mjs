import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = join(__dirname, '..', 'docs');

let indexHtml, consultoresHtml;

before(() => {
  indexHtml = readFileSync(join(siteDir, 'index.html'), 'utf8');
  consultoresHtml = readFileSync(join(siteDir, 'consultores.html'), 'utf8');
});

const WHATSAPP_NUMBER = '5521992959087';
const WA_BASE = `https://wa.me/${WHATSAPP_NUMBER}`;

// Helper: extract all href values from a string
function extractHrefs(html) {
  const matches = [...html.matchAll(/href="([^"]+)"/g)];
  return matches.map(m => m[1]);
}

// Helper: extract wa.me links with their surrounding button text
function extractWaLinks(html) {
  const matches = [...html.matchAll(/<a\s[^>]*href="(https:\/\/wa\.me\/[^"]+)"[^>]*>([^<]+)</g)];
  return matches.map(m => ({ href: m[1], text: m[2].trim() }));
}

// --- index.html (empresa) ---

describe('index.html CTAs', () => {
  it('has no mailto: links remaining', () => {
    const mailtos = extractHrefs(indexHtml).filter(h => h.startsWith('mailto:'));
    assert.equal(mailtos.length, 0, `Found leftover mailto: links: ${mailtos.join(', ')}`);
  });

  it('all wa.me links use the correct phone number', () => {
    const waLinks = extractHrefs(indexHtml).filter(h => h.includes('wa.me'));
    assert.ok(waLinks.length >= 2, `Expected at least 2 wa.me links, found ${waLinks.length}`);
    for (const link of waLinks) {
      assert.ok(link.startsWith(WA_BASE), `Link ${link} does not use number ${WHATSAPP_NUMBER}`);
    }
  });

  it('has "Solicitar demonstração" button with correct WhatsApp message', () => {
    const links = extractWaLinks(indexHtml);
    const demo = links.find(l => l.text.includes('demonstração') || l.text.includes('demonstracao'));
    assert.ok(demo, 'Missing "Solicitar demonstração" button');
    const decoded = decodeURIComponent(demo.href);
    assert.ok(decoded.includes('demonstração') || decoded.includes('demonstracao'), `Message should mention demonstração: ${decoded}`);
    assert.ok(decoded.includes('empresa'), `Message should mention empresa: ${decoded}`);
  });

  it('has "Planos corporativos" button with correct WhatsApp message', () => {
    const links = extractWaLinks(indexHtml);
    const corp = links.find(l => l.text.includes('corporativo'));
    assert.ok(corp, 'Missing "Planos corporativos" button');
    const decoded = decodeURIComponent(corp.href);
    assert.ok(decoded.includes('corporativo'), `Message should mention corporativos: ${decoded}`);
  });

  it('has link to consultores.html in nav', () => {
    assert.ok(indexHtml.includes('href="consultores.html"'), 'Missing nav link to consultores.html');
  });

  it('has WhatsApp number displayed on the page', () => {
    assert.ok(indexHtml.includes('99295-9087'), 'WhatsApp number should be visible on page');
  });
});

// --- consultores.html ---

describe('consultores.html CTAs', () => {
  it('has no mailto: links remaining', () => {
    const mailtos = extractHrefs(consultoresHtml).filter(h => h.startsWith('mailto:'));
    assert.equal(mailtos.length, 0, `Found leftover mailto: links: ${mailtos.join(', ')}`);
  });

  it('all wa.me links use the correct phone number', () => {
    const waLinks = extractHrefs(consultoresHtml).filter(h => h.includes('wa.me'));
    assert.ok(waLinks.length >= 2, `Expected at least 2 wa.me links, found ${waLinks.length}`);
    for (const link of waLinks) {
      assert.ok(link.startsWith(WA_BASE), `Link ${link} does not use number ${WHATSAPP_NUMBER}`);
    }
  });

  it('has "Quero ser parceiro" button with correct WhatsApp message', () => {
    const links = extractWaLinks(consultoresHtml);
    const partner = links.find(l => l.text.includes('parceiro'));
    assert.ok(partner, 'Missing "Quero ser parceiro" button');
    const decoded = decodeURIComponent(partner.href);
    assert.ok(decoded.includes('consultor'), `Message should mention consultor: ${decoded}`);
    assert.ok(decoded.includes('parceria'), `Message should mention parceria: ${decoded}`);
  });

  it('has "Agendar demonstração" button with correct WhatsApp message', () => {
    const links = extractWaLinks(consultoresHtml);
    const demo = links.find(l => l.text.includes('demonstração') || l.text.includes('demonstracao'));
    assert.ok(demo, 'Missing "Agendar demonstração" button');
    const decoded = decodeURIComponent(demo.href);
    assert.ok(decoded.includes('consultor'), `Message should identify as consultor: ${decoded}`);
  });

  it('has link back to index.html', () => {
    assert.ok(consultoresHtml.includes('href="index.html"'), 'Missing nav link back to index.html');
  });

  it('has WhatsApp number displayed on the page', () => {
    assert.ok(consultoresHtml.includes('99295-9087'), 'WhatsApp number should be visible on page');
  });
});

// --- Cross-page consistency ---

describe('Site consistency', () => {
  it('both pages use the same WhatsApp number', () => {
    const indexWa = extractHrefs(indexHtml).filter(h => h.includes('wa.me'));
    const consWa = extractHrefs(consultoresHtml).filter(h => h.includes('wa.me'));
    const allLinks = [...indexWa, ...consWa];
    for (const link of allLinks) {
      assert.ok(link.includes(WHATSAPP_NUMBER), `Inconsistent number in: ${link}`);
    }
  });

  it('no wa.me link has malformed URL encoding', () => {
    const allHrefs = [...extractHrefs(indexHtml), ...extractHrefs(consultoresHtml)].filter(h => h.includes('wa.me'));
    for (const href of allHrefs) {
      // Should not have unencoded spaces or special chars in the text param
      const textParam = href.split('text=')[1];
      if (textParam) {
        assert.ok(!textParam.includes(' '), `Unencoded space in wa.me text param: ${href}`);
        // Should decode without error
        assert.doesNotThrow(() => decodeURIComponent(textParam), `Invalid URL encoding in: ${href}`);
      }
    }
  });

  it('empresa page does not mention "consultor" in CTA messages', () => {
    const links = extractWaLinks(indexHtml);
    for (const l of links) {
      const decoded = decodeURIComponent(l.href);
      assert.ok(!decoded.includes('consultor'), `Empresa CTA should not mention consultor: ${decoded}`);
    }
  });

  it('consultores page CTA messages identify sender as consultor', () => {
    const links = extractWaLinks(consultoresHtml);
    for (const l of links) {
      const decoded = decodeURIComponent(l.href);
      assert.ok(decoded.includes('consultor'), `Consultor CTA should identify as consultor: ${decoded}`);
    }
  });
});
