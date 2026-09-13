"""
OCR Server — LightOnOCR-2-1B (local, CPU)
Chạy bằng: D:/AI REXI/Backend/ocr_venv/Scripts/python.exe ocr_server.py
Port: 8099
Endpoints:
  POST /ocr   — multipart file (ảnh hoặc PDF) -> { text, pages, duration_ms }
  GET  /health — { ok: true }
Model load lần đầu (lazy) ~8s, OCR ~30-60s/trang trên CPU.
"""
import io, os, sys, threading, time
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import torch
from PIL import Image
from flask import Flask, jsonify, request

MODEL_PATH = r'C:/Users/84916/LightOnOCR-2-1B'
app = Flask(__name__)

_model = None
_processor = None

def _load_model():
    global _model, _processor
    if _model is not None:
        return _model, _processor
    from transformers import LightOnOcrForConditionalGeneration, LightOnOcrProcessor
    t0 = time.time()
    _model = LightOnOcrForConditionalGeneration.from_pretrained(
        MODEL_PATH, torch_dtype=torch.float32).to('cpu')
    _processor = LightOnOcrProcessor.from_pretrained(MODEL_PATH)
    _model.eval()
    print(f'[OCR] model loaded in {time.time()-t0:.0f}s', flush=True)
    return _model, _processor

MAX_DIM = 1600  # gioi han canh dai nhat (px) - anh qua kho lam model CPU cham/ket
MAX_FILE_MB = 50  # gioi han file PDF/anh toi da
_OCR_LOCK = threading.Lock()  # model.generate khong thread-safe

def _prep_image(img):
    # Giam kich thuoc anh ve MAX_DIM neu vuot qua (giu ti le), OCR nhanh & on dinh hon
    w, h = img.size
    longest = max(w, h)
    if longest > MAX_DIM:
        scale = MAX_DIM / longest
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img

def _ocr_image(img) -> str:
    with _OCR_LOCK:  # serialize: model.generate khong thread-safe
        return _ocr_image_unlocked(img)

def _ocr_image_unlocked(img) -> str:
    model, processor = _load_model()
    conv = [{"role": "user", "content": [{"type": "image", "image": img}]}]
    inputs = processor.apply_chat_template(
        conv, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors='pt')
    inputs = {k: v.to('cpu') if v.is_floating_point() else v.to('cpu') for k, v in inputs.items()}
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=1024)
    gen = out[0, inputs['input_ids'].shape[1]:]
    return processor.decode(gen, skip_special_tokens=True)

def _pdf_to_images(pdf_bytes):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    images = []
    for page in pdf:
        bitmap = page.render(scale=1.0)  # A4 gốc ~595x842px, đủ nét cho OCR, nhanh hơn ~3x so với 2.0
        pil = bitmap.to_pil()
        images.append(pil)
    return images

@app.route('/health')
def health():
    return jsonify(ok=True, model_loaded=_model is not None)

@app.route('/ocr', methods=['POST'])
def ocr():
    f = request.files.get('file')
    if f is None:
        return jsonify(error='missing file'), 400
    data = f.read()
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        return jsonify(error=f'file too large (max {MAX_FILE_MB}MB)'), 413
    name = (f.filename or '').lower()
    t0 = time.time()
    pages_texts = []
    try:
        if name.endswith('.pdf'):
            images = _pdf_to_images(data)
            for i, img in enumerate(images):
                txt = _ocr_image(img)
                pages_texts.append(f'--- Trang {i+1} ---\n{txt}')
        else:
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            pages_texts.append(_ocr_image(_prep_image(img)))
    except Exception as e:
        return jsonify(error=f'OCR failed: {e}'), 500
    text = '\n\n'.join(pages_texts)
    return jsonify(text=text, pages=len(pages_texts), duration_ms=int((time.time()-t0)*1000))

if __name__ == '__main__':
    port = int(os.environ.get('OCR_PORT', '8099'))
    print(f'[OCR] server on :{port}', flush=True)
    app.run(host='127.0.0.1', port=port, threaded=True)
