FROM node:20-slim

# Instala ferramentas básicas se necessário
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# A porta do Render é dinâmica via PORT, mas o app usa 3737 como default
EXPOSE 3737

CMD [ "npm", "start" ]
