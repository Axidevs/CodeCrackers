FROM python:3.14-slim

WORKDIR /app

COPY ml/requirements.txt /app/ml/requirements.txt
RUN pip install --no-cache-dir -r /app/ml/requirements.txt

COPY ml/service.py /app/ml/service.py
COPY ml/inference.py /app/ml/inference.py
COPY ml/models/care_type_pipeline.joblib /app/ml/models/care_type_pipeline.joblib
COPY data/preprocess.py /app/data/preprocess.py

ENV PYTHONUNBUFFERED=1
ENV CURA_ML_HOST=0.0.0.0
ENV CURA_ML_PORT=8000

EXPOSE 8000

CMD ["python", "-m", "ml.service"]
