# ---------------------------------------------------------------------------
#  Chair Tracker Vital — Frontend (React + Vite)
# ---------------------------------------------------------------------------
FROM node:20-slim

WORKDIR /app

COPY frontend/package.json \
     frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

EXPOSE 5173

# --host 0.0.0.0 es imprescindible: por defecto Vite solo escucha en el
# localhost interno del contenedor y el navegador del host no lo alcanza.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
