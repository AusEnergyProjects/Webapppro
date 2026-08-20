declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export { getDocument, PDFWorker } from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs?worker" {
  const PdfJsWorker: { new(): Worker };
  export default PdfJsWorker;
}
