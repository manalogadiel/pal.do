FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
ENV TTS_HOST=0.0.0.0 PORT=8788
EXPOSE 8788
USER 65534:65534
CMD ["python", "server.py"]
