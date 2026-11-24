# NutriViva · Banco de dados no Firebase

O site pode funcionar de dois jeitos:

| Modo | Quando | Onde ficam os dados |
|---|---|---|
| **Demonstração** | `firebase-config.js` com `null` (padrão) | Só no navegador de cada pessoa |
| **Firebase** | `firebase-config.js` preenchido | Na nuvem (Cloud Firestore), compartilhado entre todos os aparelhos e com o robô do WhatsApp |

No modo Firebase:

- **Login seguro** (Firebase Authentication). Pacientes entram com o **celular** e a senha. Nutricionistas e equipe entram com o **e-mail**.
  As senhas ficam só no Firebase, nunca no banco.
- **Regras de segurança** (`firestore.rules`) definem quem lê e altera cada coisa. Por exemplo: o paciente vê só as próprias consultas e os receituários
  liberados para ele, e o nutricionista vê só o próprio prontuário.
- **Horários sem conflito:** dois pacientes nunca reservam o mesmo horário, nem pelo site nem pelo WhatsApp.
- **Tempo real:** um agendamento feito pelo WhatsApp aparece na hora no painel do nutricionista.

## Passo a passo (cerca de 15 minutos)

1. **Criar o projeto**: acesse <https://console.firebase.google.com>, clique em **Criar um projeto** e dê um nome, por exemplo
   `nutriviva`. O Google Analytics é opcional.
2. **Ativar o login**: menu **Authentication** → **Vamos começar** → aba **Método de login** → **E-mail/senha** → **Ativar** → **Salvar**.
3. **Criar o banco**: menu **Firestore Database** → **Criar banco de dados** → **Edição Standard** → local
   **southamerica-east1 (São Paulo)** → **Iniciar no modo de produção**.
4. **Publicar as regras**: em Firestore Database → aba **Regras**, apague o conteúdo e cole o arquivo
   [`firestore.rules`](firestore.rules) inteiro → **Publicar**.
5. **Registrar o site**: ⚙ **Configurações do projeto** → **Geral** → **Seus apps** → ícone **`</>`** (Web) → apelido `NutriViva site`
   → **Registrar app**. Copie o bloco `firebaseConfig` mostrado.
6. **Colar a configuração**: no GitHub, abra [`firebase-config.js`](firebase-config.js) → ✏️ editar → troque `null` pelo bloco copiado
   (veja o exemplo dentro do arquivo) → **Commit changes**.
7. **Autorizar o domínio**: Authentication → **Configurações** → **Domínios autorizados** → **Adicionar domínio** →
   `eguilherme88-wq.github.io`.
8. **Criar o master**: depois de 1 a 2 minutos, abra `https://eguilherme88-wq.github.io/nutriviva/#gestao`. Na primeira vez aparece a tela
   **Criar a conta master**. Essa conta cadastra a equipe e configura o robô do WhatsApp.

Pronto: nutricionistas se cadastram em **Sou nutricionista** e pacientes em **Criar minha conta** ou pelo WhatsApp.

## Custos

O plano gratuito **Spark** basta para começar: 50 mil leituras e 20 mil gravações por dia, 1 GB de dados e login por e-mail/senha sem custo.
Fotos são reduzidas automaticamente antes de salvar, para caber no banco.

## Coleções do banco

| Coleção | Conteúdo |
|---|---|
| `users` | Perfis (nome, perfil de acesso, celular, dados públicos do nutricionista). O id é o mesmo do login. |
| `slots` | Horários disponibilizados; `booking` guarda a consulta que ocupa o horário |
| `bookings` | Consultas (paciente, nutricionista, status, link da sala) |
| `prescriptions`, `clinicalEntries`, `anamneses`, `patientLinks` | Prontuário de cada nutricionista |
| `ads` | Publicidade da página inicial |
| `config` | `matrix` (matriz de acesso), `whatsapp` (configuração do robô), `setup` (primeiro acesso) |
| `waChats`, `waOutbox` | Conversas do WhatsApp e respostas da equipe a enviar |

## Pontos de atenção

- **Esqueci minha senha (pacientes):** o login do paciente usa um e-mail técnico (`celular@paciente.nutriviva.app`), então a redefinição
  por e-mail não funciona. Por enquanto, a clínica exclui o usuário em Authentication → Usuários, e o paciente se cadastra de novo pelo
  WhatsApp (o histórico continua ligado ao celular). Uma opção "esqueci a senha" pelo WhatsApp é um bom próximo passo.
- **Troca de celular ou e-mail de login** é feita pela clínica, não pelo próprio usuário.
- **Nutricionistas veem a lista de pacientes cadastrados** (nome e contato), para poder vincular pacientes. O prontuário de cada um
  continua visível só para o próprio nutricionista.
- **LGPD:** são dados de saúde. Veja [`LGPD.md`](LGPD.md): o que a plataforma já faz e o que a clínica ainda precisa fazer.
- **Testes:** as regras de segurança foram escritas e revisadas, mas o emulador oficial do Firestore não estava disponível no ambiente
  de desenvolvimento. Teste os perfis (paciente, nutricionista, equipe) logo após publicar, ou use o **Simulador de regras** do console.
