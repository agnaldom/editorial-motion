FROM python:3.12-slim
ARG INSTALL_ML=false
WORKDIR /srv
COPY apps/vision-service/requirements.txt apps/vision-service/requirements-ml.txt ./
# ponytail: simple-lama-inpainting 0.1.2 pinna pillow<10 (sem wheel para py3.12),
# então é instalado com --no-deps, ignorando o pin e usando o Pillow>=10 do base
# (o wrapper usa só APIs básicas de PIL). torchvision é dependência dele não
# coberta pelo requirements-ml.txt. Teto conhecido: se o wrapper passar a usar
# APIs removidas no Pillow 11+, trocar para LaMa direto ou um fork com pin atual.
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_ML" = "true" ]; then \
         apt-get update && apt-get install -y --no-install-recommends git \
         && rm -rf /var/lib/apt/lists/* \
         && pip install --no-cache-dir -r requirements-ml.txt \
         && pip install --no-cache-dir --no-deps simple-lama-inpainting torchvision; \
       fi
COPY apps/vision-service/app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
