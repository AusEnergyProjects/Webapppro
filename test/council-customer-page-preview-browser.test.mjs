import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserPath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {CouncilProfileSettings} from './src/components/council/CouncilProfileSettings';
    import {councilThemeVariables} from './src/lib/council-theme';
    window.fixtureSaved=[];window.fixtureRequests=[];
    window.fetch=async(url,options={})=>{
      window.fixtureRequests.push({url:String(url),method:options.method||'GET'});
      const parsed=new URL(url,location.origin);
      if(parsed.pathname==='/api/address-localities') return new Response(JSON.stringify({ok:true,postcode:parsed.searchParams.get('postcode'),localities:[{suburb:'St Kilda',state:'VIC'}]}));
      if(options.method==='POST') throw new Error('A preview must never submit a live request');
      return new Response(JSON.stringify({ok:true,suggestions:[]}));
    };
    const profile={councilId:'fixture',name:'Original Council',state:'VIC',postcodes:['3182'],logoDataUrl:null,theme:{primaryColor:'#032733',accentColor:'#0b765d'},updatedAt:'2026-10-08T00:00:00.000Z',publicJourney:{enabled:true,homeUrl:'https://www.originalcouncil.vic.gov.au/',requestedHostname:'energy.originalcouncil.vic.gov.au',domainStatus:'pending',sharePath:'/council/program/council-fixture',customDomainUrl:null}};
    function Fixture(){
      const [value,setValue]=useState({name:profile.name,postcodes:profile.postcodes,logoDataUrl:null,theme:profile.theme,publicJourney:{enabled:true,homeUrl:profile.publicJourney.homeUrl,requestedHostname:profile.publicJourney.requestedHostname}});
      return <main id="site-content" style={councilThemeVariables(value.theme,'day')}><CouncilProfileSettings profile={profile} value={value} canManage={window.fixtureCanManage!==false} dirty={true} demonstration={false} onChange={setValue} onSave={async next=>{window.fixtureSaved.push(next)}} onCancel={()=>setValue({...value,name:profile.name})} journeyMetricsSlot={<form aria-label="Journey metrics fixture"><button type="button">Synthetic metrics filter</button></form>}/></main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, write: false, outfile: "council-profile-preview.js", format: "iife", jsx: "automatic",
  plugins: [{ name: "council-preview-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Image(props){const imageProps={...props};delete imageProps.unoptimized;return React.createElement('img',imageProps)}", resolveDir: root }));
    builder.onResolve({ filter: /^@\// }, args => {
      const filename = path.join(root, "src", args.path.slice(2));
      return { path: [filename, `${filename}.ts`, `${filename}.tsx`, `${filename}.mjs`].find(candidate => fs.existsSync(candidate)) };
    });
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;

function wideLogo() {
  function chunk(name, data) {
    const content = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length, 0); content.copy(output, 4); output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4); return output;
  }
  const width = 900, height = 218;
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) pixels.set([13, 53, 51, 255], row * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

async function fixture(browser, width = 1280, canManage = true) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fixture.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }));
  await page.goto("https://fixture.invalid/");
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}body{padding:16px}${css}</style><div id="root"></div>`);
  await page.evaluate(manage => { window.fixtureCanManage = manage; }, canManage);
  await page.addScriptTag({ content: script });
  await page.getByRole("button", { name: "Preview customer page", exact: true }).waitFor();
  return { page, errors };
}

test("Current council profile previews the real, safe customer journey", { skip: !browserPath, timeout: 90000 }, async t => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const width of [1280, 390]) await t.test(`unsaved branding, logo upload, focus and enquiry at ${width}px`, async () => {
      const { page, errors } = await fixture(browser, width);
      try {
        await page.getByRole("textbox", { name: "Council name", exact: true }).fill("Synthetic Coastal Council");
        await page.getByRole("textbox", { name: "Council home website", exact: true }).fill("https://www.coastalcouncil.vic.gov.au/energy");
        await page.getByRole("textbox", { name: "Primary colour hex", exact: true }).fill("#00402F");
        await page.getByRole("textbox", { name: "Accent colour hex", exact: true }).fill("#9E5330");
        await page.getByRole("textbox", { name: "Add postcodes", exact: true }).fill("3183");
        await page.getByLabel("Council logo file", { exact: true }).setInputFiles({ name: "wide-council.png", mimeType: "image/png", buffer: wideLogo() });
        await page.getByRole("button", { name: "Change logo", exact: true }).waitFor();
        const launcher = page.getByRole("button", { name: "Preview customer page", exact: true });
        await launcher.click();
        const preview = page.locator("dialog");
        await preview.waitFor({ state: "visible" });
        await preview.getByText("Preview using Synthetic Coastal Council.", { exact: false }).waitFor();
        assert.equal(await preview.getByRole("link", { name: "Back to council website", exact: false }).getAttribute("href"), "https://www.coastalcouncil.vic.gov.au/energy");
        assert.equal(await preview.getByText("Available in participating postcodes", { exact: false }).count(), 0);
        assert.doesNotMatch(await preview.innerText(), /\b3182\b|\b3183\b/, "The customer page must not expose the council's postcode roster");
        assert.equal(await preview.locator('[style*="--c-header-start"]').evaluate(element => element.style.getPropertyValue("--c-header-start")), "#00402f");
        const logo = preview.getByRole("img", { name: "Synthetic Coastal Council logo", exact: true });
        const previewLogo = await logo.getAttribute("src");
        await logo.evaluate(image => image.decode());
        const geometry = await logo.evaluate(image => ({ width: image.clientWidth, height: image.clientHeight, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit }));
        assert.equal(geometry.naturalWidth, 512); assert.equal(geometry.naturalHeight, 124); assert.equal(geometry.fit, "contain");
        assert.ok(geometry.width >= 170 && geometry.width <= 200, `Wide logo readable at ${geometry.width}px`);
        assert.equal(await page.locator("#site-content").count(), 1);
        assert.equal(await page.locator("form form").count(), 0);
        assert.equal(await preview.getByRole("button", { name: "Close preview", exact: true }).evaluate(button => button === document.activeElement), true);
        if (process.env.COUNCIL_PREVIEW_QA_OUTPUT) {
          fs.mkdirSync(process.env.COUNCIL_PREVIEW_QA_OUTPUT, { recursive: true });
          await page.screenshot({ path: path.join(process.env.COUNCIL_PREVIEW_QA_OUTPUT, `customer-preview-${width}.jpg`), type: "jpeg" });
        }
        await page.keyboard.press("Shift+Tab");
        assert.equal(await preview.evaluate(element => element.contains(document.activeElement)), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await preview.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        const choices = preview.getByRole("group", { name: "Property type", exact: true });
        assert.equal(await choices.evaluate(element => element.scrollWidth <= element.clientWidth), true, "Property choices must fit the customer preview");
        for (const choice of await choices.getByRole("button").all()) {
          const size = await choice.boundingBox();
          assert.ok(size && size.width >= 44 && size.height >= 44, "Home and business choices remain large enough to tap");
        }
        await preview.getByRole("button", { name: "My business", exact: false }).click();
        await preview.getByRole("button", { name: "Explore upgrade options", exact: false }).click();
        const enquiry = page.getByRole("dialog", { name: "Get upgrade options without the runaround", exact: true });
        await enquiry.waitFor();
        assert.equal(await page.locator("form form").count(), 0);
        await enquiry.getByRole("checkbox", { name: /Rooftop solar/ }).check();
        await enquiry.getByRole("button", { name: "Continue", exact: true }).click();
        assert.equal(await enquiry.getByRole("combobox", { name: "Is this request for a home or a business?" }).inputValue(), "business");
        await enquiry.getByRole("textbox", { name: "Postcode *", exact: true }).fill("3182");
        await enquiry.getByRole("combobox", { name: "Suburb *", exact: true }).selectOption({ label: "St Kilda, VIC" });
        await enquiry.getByRole("combobox", { name: "Street address *", exact: true }).fill("12 Synthetic Street");
        await enquiry.getByRole("textbox", { name: "Email *", exact: true }).fill("synthetic@example.invalid");
        await enquiry.getByRole("textbox", { name: "First name *", exact: true }).fill("Synthetic");
        await enquiry.getByRole("textbox", { name: "Last name *", exact: true }).fill("Preview");
        await enquiry.getByRole("textbox", { name: "Phone *", exact: true }).fill("0400000000");
        await enquiry.getByRole("checkbox", { name: /I agree to send this request/ }).check();
        await enquiry.getByRole("button", { name: "Preview my request", exact: true }).click();
        const receipt = page.getByRole("dialog", { name: "Demonstration complete", exact: true });
        await receipt.getByRole("heading", { name: "Demonstration complete", exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.fixtureRequests.filter(request => request.method === "POST" && new URL(request.url, location.origin).pathname === "/api/leads")), []);
        await page.keyboard.press("Escape");
        await receipt.waitFor({ state: "hidden" });
        assert.equal(await preview.isVisible(), true, "Nested Escape leaves the page preview open");
        await page.keyboard.press("Escape");
        await preview.waitFor({ state: "hidden" });
        assert.equal(await launcher.evaluate(button => button === document.activeElement), true);
        assert.deepEqual(await page.evaluate(() => window.fixtureSaved), []);
        assert.equal(await page.getByRole("textbox", { name: "Council customer journey link", exact: true }).inputValue(), "https://ausenergyassessments.com/council/program/council-fixture");
        await launcher.click();
        await preview.getByRole("button", { name: "Close preview", exact: true }).click();
        await preview.waitFor({ state: "hidden" });
        assert.equal(await launcher.evaluate(button => button === document.activeElement), true);
        assert.equal(await page.getByRole("textbox", { name: "Council name", exact: true }).inputValue(), "Synthetic Coastal Council");
        assert.equal(await page.getByRole("form", { name: "Journey metrics fixture" }).evaluate(form => form.parentElement.closest("form") === null), true);
        await page.getByRole("button", { name: "Save council profile", exact: true }).click();
        await page.waitForFunction(() => window.fixtureSaved.length === 1);
        const saved = await page.evaluate(() => window.fixtureSaved[0]);
        assert.equal(saved.name, "Synthetic Coastal Council"); assert.equal(saved.logoDataUrl, previewLogo);
        assert.deepEqual(saved.postcodes, ["3182", "3183"]);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("unsafe unsaved links are rejected without opening or saving", async () => {
      const { page } = await fixture(browser);
      try {
        await page.getByRole("textbox", { name: "Council home website", exact: true }).fill("javascript:alert(1)");
        await page.getByRole("button", { name: "Preview customer page", exact: true }).click();
        await page.getByRole("alert").getByText(/HTTPS/).waitFor();
        assert.equal(await page.locator("dialog").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.fixtureSaved), []);
      } finally { await page.close(); }
    });
    await t.test("reporting viewers retain disabled editing and preview controls", async () => {
      const { page } = await fixture(browser, 390, false);
      try {
        assert.equal(await page.getByRole("textbox", { name: "Council name", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Upload council logo", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Preview customer page", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Save council profile", exact: true }).isDisabled(), true);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
