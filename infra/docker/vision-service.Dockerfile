FROM python:3.12-slim
ARG INSTALL_ML=false
WORKDIR /srv
COPY apps/vision-service/requirements.txt apps/vision-service/requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_ML" = "true" ]; then \
         apt-get update && apt-get install -y --no-install-recommends git \
         && rm -rf /var/lib/apt/lists/* \
         && pip install --no-cache-dir -r requirements-ml.txt; \
       fi
COPY apps/vision-service/app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
