import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-types.ts");
}

test("detects image, audio, and document preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(getDocumentMime("/tmp/report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
});

// SVG is the only preview MIME a browser parses as a document. Navigated to
// directly (a link in a transcript is enough) its <script> would run in the
// Worksplice origin, where it can call any /api route, so the response must
// carry a CSP. `default-src 'none'` is the clause that actually kills script.
test("streamSecurityHeaders locks image/svg+xml down with a CSP", async () => {
  const { streamSecurityHeaders } = await loadSubject();

  const headers = streamSecurityHeaders("image/svg+xml");

  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Content-Security-Policy"] ?? "", /default-src 'none'/);
});

/** Every MIME a streamed preview or download can be typed as. */
async function allPreviewMimes() {
  const { AUDIO_EXT_TO_MIME, DOCUMENT_EXT_TO_MIME, IMAGE_EXT_TO_MIME } = await loadSubject();
  return [
    ...Object.values(IMAGE_EXT_TO_MIME),
    ...Object.values(AUDIO_EXT_TO_MIME),
    ...Object.values(DOCUMENT_EXT_TO_MIME),
  ];
}

// Without nosniff a browser may sniff the body as HTML and execute it, which
// would reopen the same hole through a type we never meant to serve as a
// document. Every MIME the tables can produce must therefore be pinned.
test("every preview MIME is served with X-Content-Type-Options: nosniff", async () => {
  const { streamSecurityHeaders } = await loadSubject();
  const mimes = await allPreviewMimes();

  assert.ok(mimes.length > 0, "the MIME tables must not be empty");
  for (const mime of mimes) {
    assert.equal(streamSecurityHeaders(mime)["X-Content-Type-Options"], "nosniff", `missing nosniff for ${mime}`);
  }
});

// Reverse guard. Today SVG is the only executable preview type, so it is the
// only one carrying a CSP. If someone later adds `html: "text/html"` this test
// fails and forces them to route that type through a CSP too, instead of
// silently re-opening the SVG hole under a different extension.
test("no preview MIME other than SVG is a document type the browser executes", async () => {
  const executable = ["text/html", "application/xhtml+xml", "text/xml", "application/xml"];

  for (const mime of await allPreviewMimes()) {
    if (mime === "image/svg+xml") continue;
    assert.ok(
      !executable.includes(mime),
      `${mime} executes as a document; streamSecurityHeaders must lock it down like SVG`,
    );
  }
});

// Counterpart to the CSP above: tighten it too far and legitimate SVGs stop
// rendering. Real ones rely on inline <style>/style="" and data: URI images, so
// those two clauses are the floor.
test("the SVG CSP still allows inline styles and data-URI images", async () => {
  const { streamSecurityHeaders } = await loadSubject();

  const csp = streamSecurityHeaders("image/svg+xml")["Content-Security-Policy"] ?? "";

  assert.match(csp, /(^|; )img-src data:/);
  assert.match(csp, /(^|; )style-src 'unsafe-inline'/);
});
