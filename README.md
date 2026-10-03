# Afinador

Afinador de violão **simples e sem anúncios**, que roda no navegador do celular e pode ser instalado como app.

**Usar agora:** https://jvhubert.github.io/afinador/

- Detecta sozinho qual das 6 cordas você tocou (afinação padrão **E A D G B E**).
- Diz o que fazer: **Aperte ▶**, **◀ Afrouxe** ou **Afinado ✓**.
- Funciona sem internet depois de instalado.
- Sem anúncios, sem cadastro, sem coleta de dados: o som do microfone é analisado no próprio aparelho e não sai dele.

Como instalar no Android: veja [COMO-INSTALAR.md](COMO-INSTALAR.md).

## Como funciona

| Arquivo | Papel |
|---|---|
| `pitch.js` | Detecta a frequência pelo algoritmo YIN |
| `tuner.js` | Frequência → corda mais próxima → desvio em cents → instrução, com suavização |
| `app.js` | Microfone (sem os filtros de voz do Android), filtro passa-baixas, tela |
| `sw.js` | Guarda os arquivos no aparelho para funcionar offline |

HTML, CSS e JavaScript puros, sem etapa de build.

## Desenvolvimento

Requer Node.js 20+.

```sh
npm install            # só para os ícones e o teste no navegador
npm test               # testes de detecção e da lógica do afinador
npm run test:browser   # abre o app no Chrome com um microfone simulado
npm run serve          # http://localhost:8080
npm run icons          # regenera os PNGs a partir de icons/icon.svg
```

Ao publicar uma mudança, aumente `VERSAO` em `sw.js` para os celulares baixarem a versão nova.

## Licença

MIT
