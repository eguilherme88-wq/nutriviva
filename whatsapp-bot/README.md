# NutriViva · Atendimento automático pelo WhatsApp

Servidor que conecta o robô do NutriViva à **WhatsApp Cloud API** (API oficial da Meta).
O robô é o mesmo do simulador do site (`bot-engine.js`) e usa o mesmo banco de dados do site, o **Firebase**.

## O que o paciente consegue fazer pelo WhatsApp

| Opção | O que faz |
|---|---|
| **1** Agendar consulta | Escolhe o nutricionista, o dia e o horário e confirma. Se o número ainda não tem cadastro, o robô pede o nome e uma senha e cria o paciente. |
| **2** Minhas consultas | Lista as próximas consultas confirmadas. |
| **3** Cancelar consulta | Cancela e devolve o horário à agenda do nutricionista. |
| **4** Escolher nutricionista | Lista os profissionais; o paciente escolhe um e vê o perfil (especialidade, CRN, apresentação, valor, duração e próximo horário) e pode agendar direto com ele. |
| **5** Link da videochamada | Envia o link do Google Meet salvo na consulta (ou a sala padrão do profissional). |
| **6** Falar com um atendente | Pausa o robô e coloca a conversa na fila da equipe. O paciente volta ao robô enviando **menu**. |

O robô também entende frases como “quero marcar”, “cancelar minha consulta” e “qual o link da sala”.
O paciente é identificado pelo número de WhatsApp.

### Cadastro pelo WhatsApp e login pelo celular

- Quem agenda sem cadastro informa o **nome** e cria uma **senha** (mínimo de 8 caracteres) na conversa.
- O **celular é o login** do paciente na plataforma, e é obrigatório. No dia da consulta, ele entra com o celular e a senha e clica em *Entrar na sala*.
- A senha vai direto para o **Firebase Authentication** e não é gravada no banco. No histórico da conversa ela aparece como `•••••••• (senha ocultada)`.
  O robô orienta o paciente a apagar a mensagem com a senha no próprio WhatsApp.
- O endereço da plataforma enviado ao paciente vem da variável `SITE_URL`.

## Instalação

Requisitos:

- Node.js 20 ou mais recente;
- um endereço **HTTPS** público (Render, Railway, Fly.io, Google Cloud Run, uma VPS etc.);
- o projeto do Firebase já configurado (veja [`../FIREBASE.md`](../FIREBASE.md));
- uma conta na Meta for Developers com o produto WhatsApp.

1. **Meta for Developers**: crie um app do tipo *Business*, adicione o produto **WhatsApp** e registre o número da clínica.
   Anote o *Phone number ID* e a *Chave secreta do app* (App Secret).
2. **Token permanente**: no Business Manager, crie um *usuário do sistema* com a permissão
   `whatsapp_business_messaging` e gere um token. O token temporário do painel expira em 24 horas.
3. **Chave do Firebase**: no console do Firebase, abra ⚙ Configurações do projeto → **Contas de serviço** →
   **Gerar nova chave privada**. Salve o arquivo como `service-account.json` nesta pasta.
   Ele dá acesso total ao banco: **nunca** envie esse arquivo para o GitHub (já está no `.gitignore`).
4. **Configuração**: copie `.env.example` para `.env` e preencha os valores.
5. **Instalar e iniciar**: `npm install` e depois `npm start`. Para conferir, abra `https://seu-servidor/health`.
6. **Webhook**: no painel da Meta → WhatsApp → Configuração, informe
   `https://seu-servidor/webhook` e o mesmo `VERIFY_TOKEN` do `.env`. Assine o campo **messages**.
7. **Número no site**: no painel do site (master ou administrador) → **Atendimento WhatsApp**, preencha o número oficial.
   Com isso, o botão verde da página inicial abre o WhatsApp da clínica.

Envie “oi” para o número da clínica para testar.

## Como os dados circulam

- O robô lê e grava no **mesmo banco do site** (Cloud Firestore), com a conta de serviço.
  Agendamentos e cancelamentos pelo WhatsApp aparecem na hora nos painéis, e vice-versa.
- Quem se cadastra pelo WhatsApp ganha um login no **Firebase Authentication** (celular + senha criada na conversa).
  No dia da consulta, essa pessoa entra no site com o mesmo celular e a mesma senha.
- A reserva do horário é gravada numa **transação**: se outra pessoa reservou um instante antes, nada é gravado e o
  paciente recebe “Esse horário acabou de ser reservado”.
- **Resposta da equipe:** no painel → Atendimento WhatsApp → Abrir conversa → Responder. A mensagem vai para a coleção
  `waOutbox`, e este servidor a envia pelo WhatsApp oficial.

## Limites importantes

- **Janela de 24 horas:** pelas regras do WhatsApp, respostas livres só podem ser enviadas até 24 horas após a última mensagem do paciente.
  Lembretes enviados por iniciativa da clínica exigem **modelos de mensagem aprovados** pela Meta (com custo por mensagem).
- **Dados de saúde (LGPD):** use HTTPS, proteja o `.env` e o `service-account.json`, restrinja o acesso ao servidor e ao console do
  Firebase e informe o tratamento de dados na política de privacidade.
- Apenas mensagens de texto e respostas de botão são entendidas. Áudios, imagens e figurinhas recebem uma orientação para usar texto.

## Próximos passos sugeridos

1. Opção “esqueci minha senha” pelo WhatsApp (o servidor já consegue redefinir a senha do login do paciente).
2. Lembrete automático 24 horas antes da consulta (modelo de mensagem aprovado).
3. Botões e listas interativas do WhatsApp no lugar de respostas numéricas.
