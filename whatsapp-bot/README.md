# NutriViva · Atendimento automático pelo WhatsApp

Servidor que conecta o robô do NutriViva à **WhatsApp Cloud API** (API oficial da Meta).
O robô é o mesmo do simulador do site (`bot-engine.js`).

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
- A senha é gravada apenas como hash SHA-256, o mesmo formato do login do site. No histórico da conversa ela aparece como `•••••••• (senha ocultada)`.
  O robô orienta o paciente a apagar a mensagem com a senha no próprio WhatsApp.
- O endereço da plataforma enviado ao paciente vem da variável `SITE_URL`.

## Instalação

Requisitos: Node.js 18 ou mais recente, um endereço **HTTPS** público (Render, Railway, Fly.io, uma VPS etc.)
e uma conta na Meta for Developers com o produto WhatsApp.

1. **Meta for Developers**: crie um app do tipo *Business*, adicione o produto **WhatsApp** e registre o número da clínica.
   Anote o *Phone number ID* e a *Chave secreta do app* (App Secret).
2. **Token permanente**: no Business Manager, crie um *usuário do sistema* com a permissão
   `whatsapp_business_messaging` e gere um token. O token temporário do painel expira em 24 horas.
3. **Dados**: no site, entre como master ou administrador → **Atendimento WhatsApp** →
   **Exportar dados para o servidor**. Salve o arquivo como `data/db.json`.
4. **Configuração**: copie `.env.example` para `.env` e preencha os valores.
5. **Iniciar**: `npm start`. Para conferir, abra `https://seu-servidor/health`.
6. **Webhook**: no painel da Meta → WhatsApp → Configuração, informe
   `https://seu-servidor/webhook` e o mesmo `VERIFY_TOKEN` do `.env`. Assine o campo **messages**.

Envie “oi” para o número da clínica para testar.

## Resposta da equipe (atendente humano)

Quando o paciente escolhe a opção 6, a conversa fica com `handoff: true` e o robô para de responder.
Para enviar uma resposta pelo WhatsApp oficial:

```bash
curl -X POST https://seu-servidor/api/agent \
  -H "Authorization: Bearer SEU_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"phone":"5547999990000","text":"Olá! Aqui é a recepção.","by":"Recepção"}'
```

Envie `"handoff": false` para devolver a conversa ao robô.

## Limites importantes desta versão

- **Os dados não sincronizam com o site.** O site de demonstração guarda tudo no navegador (localStorage).
  O servidor usa a cópia `data/db.json`. Um agendamento feito pelo WhatsApp não aparece no site, e o contrário também vale.
  Para operar de verdade, site e robô precisam usar o **mesmo banco de dados** no servidor, com login seguro.
  O `bot-engine.js` já recebe o objeto de dados por parâmetro, então pode ser ligado a esse banco sem reescrever o robô.
- **Janela de 24 horas:** pelas regras do WhatsApp, respostas livres só podem ser enviadas até 24 horas após a última mensagem do paciente.
  Lembretes de consulta enviados por iniciativa da clínica exigem **modelos de mensagem aprovados** pela Meta (com custo por mensagem).
- **Dados de saúde (LGPD):** consultas e nomes de pacientes são dados sensíveis. Use HTTPS, proteja o `.env` e o `data/db.json`,
  restrinja o acesso ao servidor e informe o tratamento de dados na política de privacidade.
- Apenas mensagens de texto e respostas de botão são entendidas. Áudios, imagens e figurinhas recebem uma orientação para usar texto.
- O arquivo JSON atende bem a um consultório pequeno. Para volume maior, troque por um banco como PostgreSQL ou SQLite.

## Próximos passos sugeridos

1. Banco de dados compartilhado entre o site e o robô.
2. Lembrete automático 24 horas antes da consulta (modelo de mensagem aprovado).
3. Botões e listas interativas do WhatsApp no lugar de respostas numéricas.
4. Tela de atendimento da equipe no painel, ligada ao endpoint `/api/agent`.
