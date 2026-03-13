"use client";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { useId, useState } from "react";

type InputKind = "image" | "pdf";
type OutputFormat = "pdf" | "png" | "jpg" | "webp";
type StatusTone = "idle" | "error" | "success";

type StatusState = {
  message: string;
  tone: StatusTone;
};

const INPUT_ACCEPT = ".pdf,image/png,image/jpeg,image/webp";

const IMAGE_OUTPUTS: OutputFormat[] = ["pdf", "png", "jpg", "webp"];
const PDF_OUTPUTS: OutputFormat[] = ["png", "jpg", "webp"];

const OUTPUT_LABELS: Record<OutputFormat, string> = {
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  webp: "WEBP",
};

const OUTPUT_MIME: Record<OutputFormat, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const OUTPUT_EXTENSION: Record<OutputFormat, string> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  webp: "webp",
};

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function ConverterApp() {
  const inputId = useId();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState<OutputFormat>("pdf");
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    tone: "idle",
    message: "파일을 올리면 브라우저 안에서 바로 변환합니다.",
  });

  const inputKind = selectedFile ? getInputKind(selectedFile) : null;
  const outputOptions = inputKind === "pdf" ? PDF_OUTPUTS : IMAGE_OUTPUTS;

  function handleSelection(file: File | null) {
    if (!file) {
      return;
    }

    const kind = getInputKind(file);

    if (!kind) {
      setSelectedFile(null);
      setStatus({
        tone: "error",
        message: "PDF, PNG, JPG, WEBP 파일만 지원합니다.",
      });
      return;
    }

    setSelectedFile(file);
    setTargetFormat(resolveNextFormat(kind, targetFormat));
    setStatus({
      tone: "idle",
      message:
        kind === "pdf"
          ? "PDF는 각 페이지를 이미지로 바꿉니다. 여러 페이지면 ZIP으로 받습니다."
          : "이미지는 PDF 또는 다른 이미지 형식으로 변환할 수 있습니다.",
    });
  }

  async function handleConvert() {
    if (!selectedFile || !inputKind) {
      setStatus({
        tone: "error",
        message: "먼저 변환할 파일을 선택하세요.",
      });
      return;
    }

    setIsConverting(true);
    setStatus({
      tone: "idle",
      message: "변환 중입니다. 큰 PDF는 몇 초 걸릴 수 있습니다.",
    });

    try {
      let summary = "";

      if (inputKind === "image" && targetFormat === "pdf") {
        summary = await convertImageToPdf(selectedFile);
      } else if (inputKind === "image") {
        summary = await convertImageToImage(selectedFile, targetFormat);
      } else {
        summary = await convertPdfToImages(selectedFile, targetFormat);
      }

      setStatus({
        tone: "success",
        message: summary,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "변환 중 알 수 없는 오류가 발생했습니다.";

      setStatus({
        tone: "error",
        message,
      });
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden px-5 py-8 text-stone-950 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/50 bg-white/70 p-8 shadow-[0_20px_80px_rgba(75,59,38,0.12)] backdrop-blur xl:p-12">
          <div className="absolute inset-x-auto right-[-4rem] top-[-5rem] h-44 w-44 rounded-full bg-amber-300/35 blur-3xl" />
          <div className="absolute bottom-[-6rem] left-[-3rem] h-48 w-48 rounded-full bg-sky-300/30 blur-3xl" />

          <div className="relative grid gap-8 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-stone-50">
                Browser-side converter
              </div>
              <div className="space-y-4">
                <p className="font-mono text-sm uppercase tracking-[0.32em] text-stone-500">
                  PDF / PNG / JPG / WEBP
                </p>
                <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-stone-950 sm:text-5xl">
                  업로드 한 번으로
                  <br />
                  파일 형식을 바로 바꾸는
                  <br />
                  가벼운 변환기
                </h1>
                <p className="max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
                  서버에 파일을 보내지 않고 현재 브라우저에서 변환합니다. 이미지는
                  PDF로, PDF는 페이지별 PNG/JPG/WEBP로 바꿔 내려받을 수 있습니다.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <FeatureCard
                  label="개인정보"
                  value="로컬 처리"
                  description="파일 업로드 서버 없이 브라우저 안에서 변환"
                />
                <FeatureCard
                  label="PDF 출력"
                  value="단일 문서"
                  description="PNG, JPG, WEBP 이미지를 PDF로 묶어 저장"
                />
                <FeatureCard
                  label="이미지 출력"
                  value="ZIP 자동"
                  description="여러 페이지 PDF는 이미지 ZIP으로 다운로드"
                />
              </div>
            </div>

            <section className="rounded-[1.75rem] border border-stone-200/80 bg-stone-950 p-5 text-stone-50 shadow-[0_18px_40px_rgba(12,10,9,0.24)] sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-stone-400">
                    Converter
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">파일 선택</h2>
                </div>
                <div className="rounded-full border border-white/15 px-3 py-1 text-xs text-stone-300">
                  지원 형식 4종
                </div>
              </div>

              <label
                htmlFor={inputId}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  handleSelection(event.dataTransfer.files.item(0));
                }}
                className={`mt-6 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed px-6 text-center transition ${
                  isDragging
                    ? "border-amber-300 bg-white/10"
                    : "border-white/20 bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                <span className="rounded-full border border-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.28em] text-stone-300">
                  Drop zone
                </span>
                <p className="mt-5 text-2xl font-semibold">
                  {selectedFile ? selectedFile.name : "파일을 끌어오거나 클릭하세요"}
                </p>
                <p className="mt-3 max-w-sm text-sm leading-6 text-stone-400">
                  PDF, PNG, JPG, WEBP 파일을 올릴 수 있습니다.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.28em] text-stone-500">
                  {selectedFile
                    ? `${formatBytes(selectedFile.size)} · ${
                        inputKind === "pdf" ? "PDF 문서" : "이미지 파일"
                      }`
                    : "Single file only"}
                </p>
              </label>

              <input
                id={inputId}
                className="sr-only"
                type="file"
                accept={INPUT_ACCEPT}
                onChange={(event) =>
                  handleSelection(event.target.files?.item(0) ?? null)
                }
              />

              <div className="mt-6 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
                  출력 형식
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {outputOptions.map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setTargetFormat(format)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        targetFormat === format
                          ? "border-amber-300 bg-amber-300 text-stone-950"
                          : "border-white/15 bg-white/[0.04] text-stone-100 hover:bg-white/[0.08]"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {OUTPUT_LABELS[format]}
                      </span>
                      <span className="mt-1 block text-xs uppercase tracking-[0.24em] opacity-75">
                        {getOutputHint(format)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={!selectedFile || isConverting}
                onClick={handleConvert}
                className="mt-6 flex w-full items-center justify-center rounded-2xl bg-stone-50 px-4 py-4 text-sm font-semibold text-stone-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
              >
                {isConverting
                  ? "변환 중..."
                  : `${inputKind === "pdf" ? "PDF" : "파일"}를 ${OUTPUT_LABELS[targetFormat]}로 변환`}
              </button>

              <div
                className={`mt-4 rounded-2xl border px-4 py-4 text-sm leading-6 ${
                  status.tone === "error"
                    ? "border-red-400/40 bg-red-400/10 text-red-100"
                    : status.tone === "success"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                      : "border-white/10 bg-white/[0.04] text-stone-300"
                }`}
              >
                {status.message}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <InfoCard
            title="이미지 -> PDF"
            description="PNG, JPG, WEBP 이미지를 단일 PDF로 저장합니다."
          />
          <InfoCard
            title="이미지 -> 이미지"
            description="PNG, JPG, WEBP 사이에서 다시 인코딩해 저장합니다."
          />
          <InfoCard
            title="PDF -> 이미지"
            description="각 페이지를 PNG, JPG, WEBP로 렌더링하며 여러 장이면 ZIP으로 묶습니다."
          />
        </section>
      </div>
    </main>
  );
}

function FeatureCard({
  label,
  value,
  description,
}: {
  description: string;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.4rem] border border-stone-200/90 bg-white/80 p-4">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-stone-500">
        {label}
      </p>
      <p className="mt-3 text-xl font-semibold text-stone-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
    </article>
  );
}

function InfoCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <article className="rounded-[1.6rem] border border-white/60 bg-white/75 p-5 shadow-[0_8px_30px_rgba(75,59,38,0.08)] backdrop-blur">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-stone-500">
        Workflow
      </p>
      <h3 className="mt-3 text-xl font-semibold text-stone-950">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-stone-600">{description}</p>
    </article>
  );
}

async function convertImageToImage(file: File, targetFormat: OutputFormat) {
  const canvas = await drawFileToCanvas(file);
  const blob = await canvasToBlob(canvas, OUTPUT_MIME[targetFormat], 0.92);
  const fileName = `${stripExtension(file.name)}.${OUTPUT_EXTENSION[targetFormat]}`;

  downloadBlob(blob, fileName);
  return `${file.name} 파일을 ${OUTPUT_LABELS[targetFormat]} 형식으로 변환했습니다.`;
}

async function convertImageToPdf(file: File) {
  const canvas = await drawFileToCanvas(file);
  const pngBlob = await canvasToBlob(canvas, OUTPUT_MIME.png);
  const pngBytes = await blobToUint8Array(pngBlob);
  const pdfDocument = await PDFDocument.create();
  const image = await pdfDocument.embedPng(pngBytes);
  const page = pdfDocument.addPage([image.width, image.height]);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  const pdfBytes = await pdfDocument.save();
  const fileName = `${stripExtension(file.name)}.pdf`;
  const pdfBlob = new Blob([typedArrayToArrayBuffer(pdfBytes)], {
    type: OUTPUT_MIME.pdf,
  });

  downloadBlob(pdfBlob, fileName);
  return `${file.name} 파일을 PDF로 저장했습니다.`;
}

async function convertPdfToImages(file: File, targetFormat: OutputFormat) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    useSystemFonts: true,
  }).promise;

  const renderedPages: Array<{ blob: Blob; name: string }> = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("브라우저 캔버스를 초기화하지 못했습니다.");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    const blob = await canvasToBlob(canvas, OUTPUT_MIME[targetFormat], 0.92);
    renderedPages.push({
      blob,
      name: `${stripExtension(file.name)}-page-${String(pageIndex).padStart(2, "0")}.${OUTPUT_EXTENSION[targetFormat]}`,
    });
  }

  if (renderedPages.length === 1) {
    downloadBlob(renderedPages[0].blob, renderedPages[0].name);
    return `PDF 1페이지를 ${OUTPUT_LABELS[targetFormat]} 파일로 변환했습니다.`;
  }

  const zip = new JSZip();

  for (const page of renderedPages) {
    zip.file(page.name, await page.blob.arrayBuffer());
  }

  const archiveBlob = await zip.generateAsync({ type: "blob" });
  const archiveName = `${stripExtension(file.name)}-${targetFormat}-pages.zip`;

  downloadBlob(archiveBlob, archiveName);
  return `PDF ${renderedPages.length}페이지를 변환해 ZIP 파일로 저장했습니다.`;
}

async function drawFileToCanvas(file: File) {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("브라우저 캔버스를 초기화하지 못했습니다.");
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);
  return canvas;
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      return module;
    });
  }

  return pdfJsPromise;
}

function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지 파일을 읽지 못했습니다."));
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("출력 파일을 생성하지 못했습니다."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

async function blobToUint8Array(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function typedArrayToArrayBuffer(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer;
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function getInputKind(file: File): InputKind | null {
  const name = file.name.toLowerCase();

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp" ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp")
  ) {
    return "image";
  }

  return null;
}

function resolveNextFormat(kind: InputKind, currentFormat: OutputFormat) {
  const outputs = kind === "pdf" ? PDF_OUTPUTS : IMAGE_OUTPUTS;

  if (outputs.includes(currentFormat)) {
    return currentFormat;
  }

  return kind === "pdf" ? "png" : "pdf";
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getOutputHint(format: OutputFormat) {
  if (format === "pdf") {
    return "document";
  }

  return "image export";
}
