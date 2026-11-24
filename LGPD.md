# NutriViva · Conformidade com a LGPD e com o CFN

Este documento resume como a plataforma trata dados pessoais e o que a clínica precisa fazer fora do sistema.
**Não substitui a orientação de um advogado.** Revise-o com quem cuida da parte jurídica antes de atender pacientes reais.

## 1. O que a plataforma já faz

| Exigência | Como está atendida |
|---|---|
| Transparência (LGPD, art. 9º) | Página **Política de Privacidade e Termos de Uso** (`#privacidade`), com link no rodapé, no cadastro e no WhatsApp |
| Registro do aceite | Data e versão do aceite gravadas no cadastro (`policyVersion`, `policyAcceptedAt`) — site, conversa do site e WhatsApp |
| TCLE de telenutrição (Res. CFN nº 760/2023) | Página `#tcle`; aceite obrigatório antes da **primeira** consulta (site e WhatsApp), com data e versão gravadas (`tcleVersion`, `tcleAcceptedAt`) |
| Nutricionista apto à telenutrição | Declaração obrigatória de CRN ativo e cadastro no e-Nutricionista no cadastro do profissional (`eNutri`) |
| Direitos do titular (art. 18) | **Minha conta → Meus dados e privacidade**: baixar os próprios dados (portabilidade/acesso) e enviar pedidos de acesso, correção, exclusão ou revogação |
| Canal de atendimento ao titular | Painel master → **Privacidade (LGPD)**: dados do responsável e do canal, lista de pedidos com prazo de 15 dias e resposta ao titular |
| Segurança (art. 46) | Login pelo Firebase Authentication (senhas fora do banco), regras de acesso por perfil (`firestore.rules`), HTTPS, banco em São Paulo, senhas ocultas no histórico das conversas |
| Minimização | Publicidade sem uso de dados dos pacientes; sem rastreamento de terceiros |
| Recuperação de senha | Nutricionistas e equipe: link por e-mail (Firebase). Pacientes: “esqueci minha senha” no WhatsApp oficial (o número já é verificado pelo WhatsApp) |

## 2. Inventário de dados (registro das operações de tratamento)

| Dado | Titular | Finalidade | Base legal (sugestão a validar) | Onde fica | Guarda |
|---|---|---|---|---|---|
| Nome, celular, e-mail, senha | Pacientes, nutricionistas, equipe | Cadastro e login | Execução de contrato (art. 7º, V); segurança na autenticação (art. 11, II, “g”) | Firebase Authentication + coleção `users` | Enquanto a conta existir |
| Agenda e consultas | Pacientes e nutricionistas | Agendamento e teleconsulta | Execução de contrato (art. 7º, V) | `slots`, `bookings` | Enquanto necessário + prazos legais |
| Anamnese, medidas, exames, evolução, receituários | Pacientes | Atendimento nutricional e prontuário | Tutela da saúde (art. 11, II, “f”); obrigação regulatória (art. 11, II, “a”) | `anamneses`, `clinicalEntries`, `prescriptions` | Prontuário eletrônico: até 20 anos após o último registro (Res. CFN nº 594/2017) |
| Conversas do atendimento automático | Pacientes e interessados | Agendamento pelo WhatsApp/site | Procedimentos preliminares a pedido do titular (art. 7º, V) | `waChats` (WhatsApp); aparelho do usuário (site) | Até 12 meses |
| Pedidos de privacidade | Titulares | Cumprir direitos da LGPD | Obrigação legal (art. 7º, II) | `privacyRequests` | 5 anos (sugestão) |

**Operadores (fornecedores):** Google (Firebase: banco e login), Meta (WhatsApp Cloud API), Google Meet (videochamada), GitHub (páginas do site, sem dados de cadastro).

## 3. O que a clínica precisa fazer

1. **Preencher os dados do responsável** no painel master → Privacidade (LGPD): razão social/nome, CPF/CNPJ, endereço, e-mail do canal de privacidade.
2. **Revisão jurídica** da Política de Privacidade (`#privacidade`) e do TCLE (`#tcle`). Conferir o TCLE com o **modelo oficial anexo à Resolução CFN nº 760/2023**.
3. **Encarregado (DPO):** confirmar com o advogado se a clínica pode ser dispensada como agente de pequeno porte (Res. CD/ANPD nº 2/2022). Como há dados de saúde, o tratamento pode ser considerado de alto risco, o que afasta a dispensa. Mesmo dispensada, a clínica deve manter um canal de comunicação com o titular.
4. **Contratos com fornecedores:** aceitar os termos de tratamento de dados do Google Cloud/Firebase (Console → Configurações do projeto → Privacidade dos dados) e da Meta.
5. **Proteger o acesso administrativo:** ativar a verificação em duas etapas na conta Google dona do projeto Firebase; limitar quem tem acesso ao console.
6. **Backup:** o backup automático do Firestore exige o plano Blaze (pago). Avalie ativar, pois o prontuário precisa ser guardado por muitos anos.
7. **Nutricionistas:** confirmar CRN ativo e cadastro no e-Nutricionista de cada profissional antes de liberar a agenda.
8. **Retirar o aviso “Versão de testes”** (painel master → Privacidade) somente depois dos itens acima.

## 4. Plano de resposta a incidentes

1. **Conter:** trocar senhas afetadas, revogar acessos e chaves (Firebase → Contas de serviço; token do WhatsApp), suspender o servidor do robô se necessário.
2. **Avaliar:** quais dados, quantos titulares, por quanto tempo, se há dados de saúde (risco alto).
3. **Comunicar:** havendo risco ou dano relevante, comunicar a ANPD e os titulares afetados no prazo da regulamentação da ANPD (Res. CD/ANPD nº 15/2024), com descrição do ocorrido, dados afetados, riscos e medidas adotadas.
4. **Registrar:** manter registro de todos os incidentes, mesmo os não comunicados.
5. **Corrigir:** ajustar regras de acesso, código ou processos e registrar a lição aprendida.

## 5. Exclusão de conta (pedido do titular)

1. Responder o pedido no painel master → Privacidade (LGPD).
2. Excluir o login em Firebase → Authentication → Usuários.
3. Excluir ou anonimizar o documento do usuário em Firestore → `users` e as conversas em `waChats`.
4. **Manter** o prontuário (anamnese, registros, receituários) pelo prazo legal, informando o titular.
