FROM node:18

# Cria o diretório do aplicativo dentro do container
WORKDIR /usr/src/app

# Copia os arquivos de configuração de dependências
COPY package*.json ./

# Instala apenas dependências principais (ignorando o Electron que só serve pro PC local)
RUN npm install --omit=dev

# Copia todo o resto do código da sua máquina para o container
COPY . .

# Expõe a porta que o FiscoBot usa
EXPOSE 3737

# Comando para iniciar o servidor
CMD [ "node", "server.js" ]
