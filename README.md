# editorial-motion

## Fluxo obrigatório de trabalho

O `SPEC-editorial-motion-v1.md` é o contrato funcional e arquitetural do V1. Toda mudança deve ser rastreável no GitHub e passar pelo fluxo abaixo:

1. **Issue antes do código.** Toda correção, melhoria ou nova função deve ter uma Issue com contexto, escopo, critérios de aceite e referência ao milestone do SPEC. Se o trabalho revelar uma decisão arquitetural nova, registre também um ADR em `docs/adr/`.
2. **Uma mudança por PR.** Crie uma branch a partir de `main`, preferencialmente `codex/<issue>-<slug>`, e abra um PR que referencie a Issue (`Closes #N` ou `Refs #N`). Não faça deploy diretamente de branches ou da máquina local.
3. **PR é a unidade de deploy.** O PR deve passar pelos gates de CI antes do merge: typecheck, lint, testes unitários/esquemas, testes de integração da API, smoke test do renderer e testes do vision-service que não exigem GPU. Testes GPU podem ficar no workflow dedicado/nightly, mas um pipeline GPU completo é obrigatório antes de release.
4. **Revisão e merge.** O PR precisa descrever o comportamento alterado, evidências de validação, riscos, migrações/configuração e plano de rollback. Faça merge somente após aprovação e CI verde; o deploy de produção deve ser disparado pelo merge em `main`/workflow oficial.
5. **Fechamento.** Atualize a Issue com o resultado do deploy, versão/commit, evidências e eventuais follow-ups. Uma tarefa só é concluída quando código, CI, deploy e documentação estiverem coerentes.

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
Deploy/rollback: <workflow, risco e plano>
```

O título deve ser objetivo e incluir a Issue quando possível, por exemplo: `feat(#12): implementar contrato Motion DSL`.

### Ordem de execução

As Issues iniciais devem seguir os milestones do SPEC: skeleton → Motion DSL → análise/segmentação → background cleanup → motion planner → rotas → fluxo one-click → hardening. Dependências devem ser registradas no corpo da Issue e no PR; não contorne uma dependência apenas para acelerar o merge.
