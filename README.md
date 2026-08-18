# Tile Rush Arena

Corrida multiplayer 2D para até 15 pessoas. Todos recebem o mesmo labirinto, avançam um tile por movimento e disputam pontos ao longo das rodadas definidas pelo líder.

## Rodar na rede local

No Windows, dê dois cliques em `INICIAR-JOGO-LAN.cmd`. O iniciador:

- solicita permissão de administrador para liberar somente a porta 3001;
- compila e inicia o servidor;
- abre o jogo pelo endereço da rede local;
- copia esse endereço para você enviar aos outros jogadores.

Para iniciar manualmente:

```powershell
npm install
npm run build
npm start
```

Abra `http://localhost:3001` no computador que está servindo o jogo. Para os outros jogadores na mesma rede, use o endereço IPv4 desse computador, por exemplo `http://192.168.0.15:3001`.

No Windows, o endereço pode ser encontrado com:

```powershell
ipconfig
```

Se o Firewall do Windows pedir autorização, libere o Node.js somente para redes privadas. A conexão LAN é a opção com menor atraso.

## Jogar pela internet

O projeto inclui o `cloudflared` local após a primeira configuração. Mantenha o jogo ligado e abra outro terminal:

```powershell
npm run tunnel
```

Compartilhe a URL `trycloudflare.com` mostrada. O código da sala continua sendo criado dentro do jogo.

## Durante o desenvolvimento

```powershell
npm run dev
```

Cliente em `http://localhost:5173` e servidor multiplayer em `http://localhost:3001`.

## Verificação multiplayer

Com o servidor ligado, execute:

```powershell
npm run test:smoke
```

O teste cria uma sala, conecta dois jogadores, inicia uma rodada, resolve o percurso e confirma a chegada sincronizada.
