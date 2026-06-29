FROM python:3.12-slim
WORKDIR /app
COPY src/ src/
RUN mkdir -p data/corpus cache
CMD ["python3","-m","src.agent_loop"]
