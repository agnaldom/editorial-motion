# editorial-motion

## Fluxo obrigatório de trabalho

O `SPEC-editorial-motion-v1.md` é o contrato funcional e arquitetural do V1. Toda mudança deve ser rastreável no GitHub e passar pelo fluxo abaixo:

1. **Issue antes do código.** Toda correção, melhoria ou nova função deve ter uma Issue com contexto, escopo, critérios de aceite e referência ao milestone do SPEC. Se o trabalho revelar uma decisão arquitetural nova, registre também um ADR em `docs/adr/`.
2. **Uma mudança por PR.** Crie uma branch nova a partir de `main`, preferencialmente `codex/<issue>-<slug>`, e abra um PR que referencie a Issue (`Closes #N` ou `Refs #N`). O trabalho é executado e validado localmente; não há deploy neste momento.
3. **Quality gates locais.** Os hooks versionados de `pre-commit` e `pre-push` devem estar instalados (`./scripts/install-hooks.sh`). Eles bloqueiam segredos/artefatos acidentais e executam os checks disponíveis no repositório.
4. **Revisão e merge.** O PR precisa descrever o comportamento alterado, evidências de validação, riscos e configuração. Faça merge somente após aprovação, checks locais e CI verde quando o workflow existir.
5. **Fechamento.** Atualize a Issue com o resultado da implementação, validações, commit/PR e eventuais follow-ups. Deploy fica explicitamente fora do escopo atual.

### Regras de escopo

- Não gerar React/Remotion arbitrário com LLM: o planner produz somente Motion DSL JSON validado.
- Preservar os contratos do SPEC: câmera estática por padrão, coordenadas normalizadas, regiões protegidas, render determinístico via Remotion e saída MP4 2560×1440/30 fps com duração mínima de 8 s.
- Mudanças que alterem as decisões da seção 40 do SPEC exigem ADR e aprovação explícita no PR.
- Nunca commitar segredos, uploads, artefatos de render ou credenciais. Use variáveis de ambiente e URLs assinadas.

### Convenção de PR

Todo PR deve conter:

```text
Issue: #<número>
Tipo: Correção | Melhoria | Nova função
Milestone do SPEC: <M0–M7 ou seção aplicável>
Critérios de aceite: <checklist>
Validação: <comandos e resultados>
Execução local: <comando, risco e plano de reversão>
```

O título deve ser objetivo e incluir a Issue quando possível, por exemplo: `feat(#12): implementar contrato Motion DSL`.

### Ordem de execução

As Issues iniciais devem seguir os milestones do SPEC: skeleton → Motion DSL → análise/segmentação → background cleanup → motion planner → rotas → fluxo one-click → hardening. Dependências devem ser registradas no corpo da Issue e no PR; não contorne uma dependência apenas para acelerar o merge.

### Hooks de quality gate

Instale uma vez por clone:

```bash
./scripts/install-hooks.sh
```

O `pre-commit` verifica arquivos sensíveis, artefatos de render e executa o quality gate rápido. O `pre-push` executa o quality gate completo disponível (JavaScript/TypeScript e Python) antes de publicar a branch. Os hooks são mantidos no repositório para que todos os agentes e colaboradores usem o mesmo padrão.
