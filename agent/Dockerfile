FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OTEL_SDK_DISABLED=true
WORKDIR /app
COPY agent/requirements.lock.txt /app/requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY agent/pyproject.toml /app/pyproject.toml
COPY agent/verra_agent /app/verra_agent
RUN pip install --no-cache-dir --no-deps .
USER 10001
EXPOSE 8080
CMD ["python", "-m", "verra_agent.runtime"]
