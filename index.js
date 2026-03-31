const STORAGE_KEY = "mega_historico_15";
const NUMBER_MIN = 1;
const NUMBER_MAX = 25;
const GAME_SIZE = 15;
const MIN_HISTORY_FOR_BACKTEST = 12;
const MAX_BACKTEST_ROUNDS = 30;
const MAX_GAME_HISTORY_SAMPLE = 25;
const DEFAULT_CANDIDATE_COUNT = 90;

let graficoFrequencia = null;
let graficoAtraso = null;
let ultimaAnalise = null;

const historicoEl = document.getElementById("historico");
const arquivoEl = document.getElementById("arquivo");
const quantidadeJogosEl = document.getElementById("quantidadeJogos");
const resumoEl = document.getElementById("resumo");
const previsoesEl = document.getElementById("previsoes");
const rankingEl = document.getElementById("ranking");
const menosProvaveisEl = document.getElementById("menosProvaveis");
const comparacaoEl = document.getElementById("comparacao");
const scoreNumeroEl = document.getElementById("scoreNumero");
const scoreExplicacaoEl = document.getElementById("scoreExplicacao");

document.getElementById("btnSalvar").addEventListener("click", salvar);
document.getElementById("btnCarregar").addEventListener("click", carregar);
document.getElementById("btnAnalisar").addEventListener("click", analisar);
document.getElementById("btnPrever").addEventListener("click", gerarJogos);
arquivoEl.addEventListener("change", importarArquivo);
scoreNumeroEl.addEventListener("change", renderExplicacaoScoreAtual);

inicializarSeletorScore();

function salvar() {
  localStorage.setItem(STORAGE_KEY, historicoEl.value.trim());
  alert("Historico salvo com sucesso.");
}

function carregar() {
  historicoEl.value = localStorage.getItem(STORAGE_KEY) || "";
  alert("Historico carregado.");
}

function importarArquivo(event) {
  const arquivo = event.target.files?.[0];
  if (!arquivo) return;

  const reader = new FileReader();
  reader.onload = () => {
    const conteudo = String(reader.result || "");
    const linhas = conteudo
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter(Boolean)
      .reverse();

    historicoEl.value = linhas.join("\n");
  };
  reader.readAsText(arquivo, "UTF-8");
}

function analisar() {
  const leitura = lerHistorico();
  if (!leitura.concursos.length) {
    renderErro("Nenhuma sequencia valida encontrada. Cada linha precisa conter 15 numeros unicos entre 1 e 25.");
    return;
  }

  ultimaAnalise = calcularAnalise(leitura.concursos);
  const backtest = executarBacktest(leitura.concursos);

  renderResumo(ultimaAnalise, leitura, null, backtest);
  renderRanking(ultimaAnalise.ranking);
  renderMenosProvaveis(ultimaAnalise);
  renderGraficos(ultimaAnalise);
  previsoesEl.innerHTML = "";
  renderBacktest(backtest);
}

function gerarJogos() {
  const leitura = lerHistorico();
  if (!leitura.concursos.length) {
    renderErro("Nenhuma sequencia valida encontrada. Cada linha precisa conter 15 numeros unicos entre 1 e 25.");
    return;
  }

  ultimaAnalise = calcularAnalise(leitura.concursos);
  const quantidade = Number(quantidadeJogosEl.value) || 3;
  const jogos = gerarMelhoresJogos(ultimaAnalise, leitura.concursos, quantidade, {
    candidateCount: DEFAULT_CANDIDATE_COUNT,
    diversityThreshold: 11,
    includePerformance: true
  });
  const backtest = executarBacktest(leitura.concursos);

  renderResumo(ultimaAnalise, leitura, jogos[0]?.numeros || null, backtest);
  renderRanking(ultimaAnalise.ranking);
  renderMenosProvaveis(ultimaAnalise);
  renderGraficos(ultimaAnalise);
  renderJogos(jogos);
  renderBacktest(backtest, jogos[0]?.numeros || null, leitura.concursos[leitura.concursos.length - 1]);
}

function lerHistorico() {
  const texto = historicoEl.value.trim();
  if (!texto) {
    return {
      concursos: [],
      totalLinhas: 0,
      validos: 0,
      invalidos: 0,
      duplicados: 0
    };
  }

  const linhas = texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const concursos = [];
  const vistos = new Set();
  let invalidos = 0;
  let duplicados = 0;

  for (const linha of linhas) {
    const numerosLinha = linha.match(/\d+/g)?.map(Number) || [];
    if (numerosLinha.length < GAME_SIZE) {
      invalidos++;
      continue;
    }

    const ultimos15 = numerosLinha
      .slice(-GAME_SIZE)
      .filter((n) => Number.isInteger(n) && n >= NUMBER_MIN && n <= NUMBER_MAX);

    const unicos = [...new Set(ultimos15)].sort((a, b) => a - b);
    if (unicos.length !== GAME_SIZE) {
      invalidos++;
      continue;
    }

    const chave = unicos.join("-");
    if (vistos.has(chave)) {
      duplicados++;
      continue;
    }

    vistos.add(chave);
    concursos.push(unicos);
  }

  return {
    concursos,
    totalLinhas: linhas.length,
    validos: concursos.length,
    invalidos,
    duplicados
  };
}

function calcularAnalise(concursos) {
  const total = concursos.length;
  const recentWindow = concursos.slice(Math.max(0, total - 12));
  const previousWindow = concursos.slice(Math.max(0, total - 24), Math.max(0, total - 12));
  const ultimoConcurso = concursos[total - 1] || [];
  const stats = {};
  const pairMap = new Map();
  const transitionMap = {};
  let repeticoesEntreConcursos = [];

  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    stats[n] = {
      numero: n,
      freq: 0,
      weightedFreq: 0,
      atraso: total,
      recente: 0,
      paresFortes: 0,
      tendencia: 0,
      transitionSignal: 0,
      repetiuDoUltimo: ultimoConcurso.includes(n) ? 1 : 0,
      faixa: obterFaixa(n),
      score: 0
    };

    transitionMap[n] = {
      presentCount: 0,
      absentCount: 0,
      presentToPresent: 0,
      absentToPresent: 0
    };
  }

  concursos.forEach((concurso, index) => {
    const pesoRecencia = 1 + (index / Math.max(1, total - 1)) * 2.8;
    const atualSet = new Set(concurso);

    concurso.forEach((n) => {
      stats[n].freq += 1;
      stats[n].weightedFreq += pesoRecencia;
      stats[n].atraso = Math.min(stats[n].atraso, total - 1 - index);
    });

    for (let i = 0; i < concurso.length; i++) {
      for (let j = i + 1; j < concurso.length; j++) {
        const a = concurso[i];
        const b = concurso[j];
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        pairMap.set(key, (pairMap.get(key) || 0) + 1);
      }
    }

    if (index > 0) {
      const anteriorSet = new Set(concursos[index - 1]);
      repeticoesEntreConcursos.push(intersecaoCount(concurso, concursos[index - 1]));

      for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
        if (anteriorSet.has(n)) {
          transitionMap[n].presentCount += 1;
          if (atualSet.has(n)) transitionMap[n].presentToPresent += 1;
        } else {
          transitionMap[n].absentCount += 1;
          if (atualSet.has(n)) transitionMap[n].absentToPresent += 1;
        }
      }
    }
  });

  recentWindow.forEach((concurso) => {
    concurso.forEach((n) => {
      stats[n].recente += 1;
    });
  });

  for (const [key, valor] of pairMap.entries()) {
    if (valor < 2) continue;
    const [a, b] = key.split("-").map(Number);
    stats[a].paresFortes += valor;
    stats[b].paresFortes += valor;
  }

  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    const recenteNorm = stats[n].recente / Math.max(1, recentWindow.length);
    const anteriorCount = previousWindow.reduce((acc, jogo) => acc + (jogo.includes(n) ? 1 : 0), 0);
    const anteriorNorm = anteriorCount / Math.max(1, previousWindow.length || 1);
    stats[n].tendencia = recenteNorm - anteriorNorm;

    const wasInLast = ultimoConcurso.includes(n);
    const transitions = transitionMap[n];
    const stayProb = transitions.presentToPresent / Math.max(1, transitions.presentCount);
    const returnProb = transitions.absentToPresent / Math.max(1, transitions.absentCount);
    stats[n].transitionSignal = wasInLast ? stayProb : returnProb;
  }

  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    const s = stats[n];
    const freqScore = s.freq / Math.max(1, total);
    const weightedScore = s.weightedFreq / Math.max(1, total * 3);
    const atrasoScore = 1 - s.atraso / Math.max(1, total);
    const recenteScore = s.recente / Math.max(1, recentWindow.length);
    const pairScore = normalizar(s.paresFortes, 0, 140);
    const trendScore = normalizar(s.tendencia, -0.8, 0.8);
    const transitionScore = s.transitionSignal;

    s.componentes = {
      frequencia: freqScore * 0.18,
      frequenciaPonderada: weightedScore * 0.22,
      presencaRecente: recenteScore * 0.16,
      tendencia: trendScore * 0.12,
      pares: pairScore * 0.10,
      transicao: transitionScore * 0.12,
      atraso: atrasoScore * 0.06,
      repeticaoUltimo: s.repetiuDoUltimo * 0.04
    };

    s.score = Object.values(s.componentes).reduce((acc, valor) => acc + valor, 0);
  }

  const ranking = Object.values(stats).sort((a, b) => b.score - a.score);
  const meta = inferirMetas(concursos, repeticoesEntreConcursos);

  return { stats, ranking, pairMap, ultimoConcurso, meta };
}

function gerarMelhoresJogos(analise, concursos, quantidade, opcoes = {}) {
  const candidateCount = opcoes.candidateCount || DEFAULT_CANDIDATE_COUNT;
  const includePerformance = opcoes.includePerformance !== false;
  const diversityThreshold = opcoes.diversityThreshold || 11;
  const candidatos = [];
  const vistos = new Set();

  for (let i = 0; i < candidateCount; i++) {
    const numeros = normalizarJogo(gerarSequenciaCandidata(analise, concursos, i + 1));
    const chave = numeros.join("-");
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const performance = includePerformance ? avaliarJogoGerado(numeros, concursos) : { mediaAcertos: 0, percentual: 0, maximo: 0, weightedMediaAcertos: 0 };
    const modelScore = pontuarJogoCompleto(numeros, analise, concursos, performance);
    candidatos.push({ numeros, performance, modelScore });
  }

  candidatos.sort((a, b) => b.modelScore - a.modelScore);

  const selecionados = [];
  for (const candidato of candidatos) {
    const muitoParecido = selecionados.some((item) => intersecaoCount(item.numeros, candidato.numeros) > diversityThreshold);
    if (!muitoParecido) {
      selecionados.push(candidato);
    }
    if (selecionados.length === quantidade) break;
  }

  for (const candidato of candidatos) {
    if (selecionados.length === quantidade) break;
    if (!selecionados.find((item) => item.numeros.join("-") === candidato.numeros.join("-"))) {
      selecionados.push(candidato);
    }
  }

  return selecionados;
}

function normalizarJogo(numeros) {
  return [...new Set(numeros)]
    .filter((n) => Number.isInteger(n) && n >= NUMBER_MIN && n <= NUMBER_MAX)
    .sort((a, b) => a - b)
    .slice(0, GAME_SIZE);
}

function gerarSequenciaCandidata(analise, concursos, seedBase = 1) {
  const metas = analise.meta;
  const escolhidos = [];
  const usados = new Set();
  const rng = criarGerador(seedBase * 9973 + concursos.length * 37);
  const numerosDisponiveis = analise.ranking.map((item) => item.numero);

  while (escolhidos.length < GAME_SIZE) {
    const candidatos = numerosDisponiveis
      .filter((numero) => !usados.has(numero))
      .map((numero) => ({
        numero,
        score: pontuarCandidato(numero, escolhidos, analise, metas) + rng() * 6
      }))
      .sort((a, b) => b.score - a.score);

    const janela = Math.min(5, candidatos.length);
    const indiceEscolha = Math.floor(rng() * janela);
    const escolhido = candidatos[indiceEscolha]?.numero;
    if (escolhido == null) break;

    escolhidos.push(escolhido);
    usados.add(escolhido);
  }

  const ajustado = ajustarSequenciaFinal(escolhidos.sort((a, b) => a - b), analise, metas);
  return melhorarPorTrocas(ajustado, analise, concursos);
}

function pontuarCandidato(numero, escolhidos, analise, metas) {
  const stat = analise.stats[numero];
  const base = stat.score * 100;
  let paresBonus = 0;
  let faixaBonus = 0;
  let paridadeBonus = 0;
  let repeticaoBonus = 0;
  let sequenciaPenalty = 0;

  for (const atual of escolhidos) {
    const key = `${Math.min(numero, atual)}-${Math.max(numero, atual)}`;
    paresBonus += (analise.pairMap.get(key) || 0) * 0.8;
  }

  const faixas = contarFaixas(escolhidos);
  const faixaNumero = obterFaixa(numero);
  if (faixas[faixaNumero] < metas.faixas[faixaNumero]) {
    faixaBonus += 5;
  }

  const pares = escolhidos.filter((n) => n % 2 === 0).length;
  const impares = escolhidos.length - pares;
  if (numero % 2 === 0 && pares < metas.paresMax) paridadeBonus += 3;
  if (numero % 2 !== 0 && impares < metas.imparesMax) paridadeBonus += 3;

  const repetidosDoUltimo = intersecaoCount(escolhidos, analise.ultimoConcurso);
  if (analise.ultimoConcurso.includes(numero) && repetidosDoUltimo < metas.repeticoesUltimoMax) {
    repeticaoBonus += 4;
  }
  if (!analise.ultimoConcurso.includes(numero) && repetidosDoUltimo >= metas.repeticoesUltimoMin) {
    repeticaoBonus += 2;
  }

  const teste = [...escolhidos, numero].sort((a, b) => a - b);
  const bloco = maiorBlocoConsecutivo(teste);
  if (bloco > metas.maxConsecutivos) {
    sequenciaPenalty += (bloco - metas.maxConsecutivos) * 9;
  }

  return base + paresBonus + faixaBonus + paridadeBonus + repeticaoBonus - sequenciaPenalty;
}

function ajustarSequenciaFinal(sequencia, analise, metas) {
  let atual = [...new Set(sequencia)].sort((a, b) => a - b);

  while (atual.length < GAME_SIZE) {
    const proximo = analise.ranking.find((item) => !atual.includes(item.numero));
    if (!proximo) break;
    atual.push(proximo.numero);
    atual.sort((a, b) => a - b);
  }

  for (let tentativa = 0; tentativa < 80; tentativa++) {
    const scoreAtual = pontuarJogoCompleto(atual, analise, [], null);
    const removivel = [...atual].sort((a, b) => analise.stats[a].score - analise.stats[b].score)[0];
    const candidatos = analise.ranking.map((item) => item.numero).filter((n) => !atual.includes(n));
    let melhorTroca = null;
    let melhorScore = scoreAtual;

    for (const candidato of candidatos.slice(0, 10)) {
      const teste = atual.filter((n) => n !== removivel).concat(candidato).sort((a, b) => a - b);
      const score = pontuarJogoCompleto(teste, analise, [], null);
      if (score > melhorScore) {
        melhorScore = score;
        melhorTroca = teste;
      }
    }

    if (!melhorTroca) break;
    atual = melhorTroca;
  }

  const pares = atual.filter((n) => n % 2 === 0).length;
  const soma = atual.reduce((acc, n) => acc + n, 0);
  const bloco = maiorBlocoConsecutivo(atual);
  const repetidos = intersecaoCount(atual, analise.ultimoConcurso);

  const precisaAjuste =
    pares < metas.paresMin ||
    pares > metas.paresMax ||
    soma < metas.somaMin ||
    soma > metas.somaMax ||
    bloco > metas.maxConsecutivos ||
    repetidos < metas.repeticoesUltimoMin ||
    repetidos > metas.repeticoesUltimoMax;

  if (precisaAjuste) {
    atual = forcarMetas(atual, analise, metas);
  }

  return atual.slice(0, GAME_SIZE).sort((a, b) => a - b);
}

function forcarMetas(jogo, analise, metas) {
  let atual = [...jogo].sort((a, b) => a - b);
  for (let tentativa = 0; tentativa < 60; tentativa++) {
    const candidatos = analise.ranking.map((item) => item.numero);
    const baseScore = pontuarJogoCompleto(atual, analise, [], null);
    let melhor = atual;
    let melhorScore = baseScore;

    for (const saida of atual) {
      for (const entrada of candidatos.slice(0, 14)) {
        if (atual.includes(entrada)) continue;
        const teste = atual.filter((n) => n !== saida).concat(entrada).sort((a, b) => a - b);
        const score = pontuarJogoCompleto(teste, analise, [], null);
        if (score > melhorScore) {
          melhorScore = score;
          melhor = teste;
        }
      }
    }

    if (melhor === atual) break;
    atual = melhor;
  }
  return atual;
}

function melhorarPorTrocas(jogo, analise, concursos) {
  let atual = [...jogo];
  let melhorScore = pontuarJogoCompleto(atual, analise, concursos, avaliarJogoGerado(atual, concursos));
  const candidatos = analise.ranking.map((item) => item.numero);

  for (let tentativa = 0; tentativa < 35; tentativa++) {
    let houveMelhora = false;

    for (const saida of atual) {
      for (const entrada of candidatos.slice(0, 16)) {
        if (atual.includes(entrada)) continue;
        const teste = atual.filter((n) => n !== saida).concat(entrada).sort((a, b) => a - b);
        const performance = avaliarJogoGerado(teste, concursos);
        const score = pontuarJogoCompleto(teste, analise, concursos, performance);
        if (score > melhorScore) {
          atual = teste;
          melhorScore = score;
          houveMelhora = true;
        }
      }
    }

    if (!houveMelhora) break;
  }

  return atual;
}

function pontuarJogoCompleto(jogo, analise, concursos = [], performance = null) {
  const metas = analise.meta;
  const somaStats = jogo.reduce((acc, numero) => acc + analise.stats[numero].score * 100, 0);
  const pairStrength = somarForcaPares(jogo, analise.pairMap);
  const pares = jogo.filter((n) => n % 2 === 0).length;
  const soma = jogo.reduce((acc, n) => acc + n, 0);
  const bloco = maiorBlocoConsecutivo(jogo);
  const repetidos = intersecaoCount(jogo, analise.ultimoConcurso);
  const faixas = contarFaixas(jogo);

  let score = somaStats + pairStrength * 0.45;
  score -= Math.abs(pares - metas.paresCentro) * 6;
  score -= penalidadeFaixas(faixas, metas.faixas) * 4;
  score -= Math.abs(soma - metas.somaCentro) * 0.18;
  score -= Math.max(0, bloco - metas.maxConsecutivos) * 12;
  score -= Math.abs(repetidos - metas.repeticoesUltimoCentro) * 5;

  if (performance) {
    score += performance.weightedMediaAcertos * 18;
    score += performance.mediaAcertos * 8;
    score += performance.maximo * 2;
  }

  if (concursos.length) {
    const ultimo = concursos[concursos.length - 1] || [];
    score += contarAcertos(jogo, ultimo) * 1.5;
  }

  return score;
}

function inferirMetas(concursos, repeticoesEntreConcursos = []) {
  const amostra = concursos.slice(Math.max(0, concursos.length - 24));
  const paresLista = amostra.map((jogo) => jogo.filter((n) => n % 2 === 0).length);
  const somaLista = amostra.map((jogo) => jogo.reduce((acc, n) => acc + n, 0));
  const blocoLista = amostra.map((jogo) => maiorBlocoConsecutivo(jogo));
  const repeticoes = repeticoesEntreConcursos.slice(Math.max(0, repeticoesEntreConcursos.length - 24));

  const faixas = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  amostra.forEach((jogo) => {
    jogo.forEach((n) => {
      faixas[obterFaixa(n)] += 1;
    });
  });

  const totalJogos = Math.max(1, amostra.length);
  const mediaPares = media(paresLista);
  const mediaSoma = media(somaLista);
  const mediaRepeticoes = media(repeticoes.length ? repeticoes : [9]);

  return {
    paresMin: Math.max(5, Math.floor(mediaPares - 1)),
    paresMax: Math.min(10, Math.ceil(mediaPares + 1)),
    paresCentro: mediaPares,
    imparesMax: 10,
    somaMin: Math.floor(mediaSoma - 18),
    somaMax: Math.ceil(mediaSoma + 18),
    somaCentro: mediaSoma,
    maxConsecutivos: Math.max(3, Math.round(media(blocoLista))),
    repeticoesUltimoMin: Math.max(6, Math.floor(mediaRepeticoes - 1)),
    repeticoesUltimoMax: Math.min(12, Math.ceil(mediaRepeticoes + 1)),
    repeticoesUltimoCentro: mediaRepeticoes,
    faixas: {
      1: Math.round(faixas[1] / totalJogos),
      2: Math.round(faixas[2] / totalJogos),
      3: Math.round(faixas[3] / totalJogos),
      4: Math.round(faixas[4] / totalJogos),
      5: Math.round(faixas[5] / totalJogos)
    }
  };
}

function executarBacktest(concursos) {
  if (concursos.length <= MIN_HISTORY_FOR_BACKTEST) {
    return {
      rodadas: 0,
      mediaAcertos: 0,
      percentualMedio: 0,
      melhorAcerto: 0,
      piorAcerto: 0,
      distribuicao: {},
      detalhe: "Historico insuficiente para backtesting."
    };
  }

  const inicio = Math.max(MIN_HISTORY_FOR_BACKTEST, concursos.length - MAX_BACKTEST_ROUNDS);
  const resultados = [];

  for (let i = inicio; i < concursos.length; i++) {
    const treino = concursos.slice(0, i);
    const alvo = concursos[i];
    const analise = calcularAnalise(treino);
    const jogos = gerarMelhoresJogos(analise, treino, 1, {
      candidateCount: 28,
      diversityThreshold: 15,
      includePerformance: false
    });
    const previsto = jogos[0]?.numeros || gerarSequenciaCandidata(analise, treino, i + 1);
    resultados.push(contarAcertos(previsto, alvo));
  }

  const distribuicao = {};
  resultados.forEach((acertos) => {
    distribuicao[acertos] = (distribuicao[acertos] || 0) + 1;
  });

  const mediaAcertos = media(resultados);

  return {
    rodadas: resultados.length,
    mediaAcertos,
    percentualMedio: (mediaAcertos / GAME_SIZE) * 100,
    melhorAcerto: Math.max(...resultados),
    piorAcerto: Math.min(...resultados),
    distribuicao,
    detalhe: `Backtesting em ${resultados.length} concursos anteriores.`
  };
}

function avaliarJogoGerado(jogo, concursos) {
  const amostra = concursos.slice(Math.max(0, concursos.length - MAX_GAME_HISTORY_SAMPLE));
  const acertos = amostra.map((concurso) => contarAcertos(jogo, concurso));
  const mediaAcertos = acertos.length ? media(acertos) : 0;
  const maximo = acertos.length ? Math.max(...acertos) : 0;
  const weightedMediaAcertos = acertos.length
    ? acertos.reduce((acc, valor, indice) => acc + valor * (indice + 1), 0) / acertos.reduce((acc, _, indice) => acc + indice + 1, 0)
    : 0;
  const percentual = (weightedMediaAcertos / GAME_SIZE) * 100;

  return {
    mediaAcertos,
    weightedMediaAcertos,
    percentual,
    maximo
  };
}

function somarForcaPares(jogo, pairMap) {
  let total = 0;
  for (let i = 0; i < jogo.length; i++) {
    for (let j = i + 1; j < jogo.length; j++) {
      const key = `${Math.min(jogo[i], jogo[j])}-${Math.max(jogo[i], jogo[j])}`;
      total += pairMap.get(key) || 0;
    }
  }
  return total;
}

function penalidadeFaixas(faixasAtuais, faixasMeta) {
  return Object.keys(faixasMeta).reduce((acc, chave) => acc + Math.abs((faixasAtuais[chave] || 0) - faixasMeta[chave]), 0);
}

function contarAcertos(jogoA, jogoB) {
  const conjunto = new Set(jogoB);
  return jogoA.filter((n) => conjunto.has(n)).length;
}

function intersecaoCount(a, b) {
  const conjunto = new Set(b);
  return a.filter((n) => conjunto.has(n)).length;
}

function criarGerador(seedInicial) {
  let seed = seedInicial % 2147483647;
  if (seed <= 0) seed += 2147483646;
  return function () {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function inicializarSeletorScore() {
  scoreNumeroEl.innerHTML = "";
  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = formatar(n);
    scoreNumeroEl.appendChild(option);
  }
}

function renderExplicacaoScoreAtual() {
  if (!ultimaAnalise) {
    scoreExplicacaoEl.innerHTML = '<div class="alert">Analise o historico para ver a explicacao do score de cada numero.</div>';
    return;
  }

  const numero = Number(scoreNumeroEl.value || 1);
  const stat = ultimaAnalise.stats[numero];
  if (!stat) {
    scoreExplicacaoEl.innerHTML = '<div class="alert">Numero nao encontrado na analise atual.</div>';
    return;
  }

  const cards = [
    montarCardScore("Score final", stat.score, "Soma ponderada dos fatores heuristicas usados no ranking."),
    montarCardScore("Frequencia", stat.componentes.frequencia, `${stat.freq} presencas no historico.`),
    montarCardScore("Freq. ponderada", stat.componentes.frequenciaPonderada, `${stat.weightedFreq.toFixed(2)} com peso maior para concursos recentes.`),
    montarCardScore("Presenca recente", stat.componentes.presencaRecente, `${stat.recente} aparicoes na janela recente.`),
    montarCardScore("Tendencia", stat.componentes.tendencia, `Variacao recente contra a janela anterior: ${stat.tendencia.toFixed(3)}.`),
    montarCardScore("Pares fortes", stat.componentes.pares, `${stat.paresFortes} pontos de coocorrencia com outros numeros.`),
    montarCardScore("Transicao", stat.componentes.transicao, `Sinal de repetir ou voltar no proximo concurso: ${stat.transitionSignal.toFixed(3)}.`),
    montarCardScore("Atraso", stat.componentes.atraso, `${stat.atraso} concursos desde a ultima aparicao.`),
    montarCardScore("Repetiu no ultimo", stat.componentes.repeticaoUltimo, stat.repetiuDoUltimo ? "Este numero saiu no ultimo concurso." : "Este numero nao saiu no ultimo concurso.")
  ].join("");

  scoreExplicacaoEl.innerHTML = `
    <article class="score-card score-card-main">
      <div class="score-card-head">
        <span class="score-ball">${formatar(numero)}</span>
        <div>
          <h3>Leitura do numero ${formatar(numero)}</h3>
          <p>O score nao e uma chance real de sorteio. Ele e um indice comparativo: quanto maior, mais aderente ao padrao historico o numero parece.</p>
        </div>
      </div>
      <div class="score-formula">
        Score = frequencia + frequencia ponderada + presenca recente + tendencia + pares + transicao + atraso + repeticao com ultimo concurso
      </div>
    </article>
    ${cards}
  `;
}

function montarCardScore(titulo, valor, descricao) {
  return `
    <article class="score-card">
      <h3>${titulo}</h3>
      <strong>${Number(valor).toFixed(3)}</strong>
      <p>${descricao}</p>
    </article>
  `;
}
function obterFaixa(numero) {
  if (numero <= 5) return 1;
  if (numero <= 10) return 2;
  if (numero <= 15) return 3;
  if (numero <= 20) return 4;
  return 5;
}

function contarFaixas(numeros) {
  const faixas = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  numeros.forEach((n) => {
    faixas[obterFaixa(n)] += 1;
  });
  return faixas;
}

function maiorBlocoConsecutivo(numeros) {
  if (!numeros.length) return 0;
  const ordenados = [...numeros].sort((a, b) => a - b);
  let maior = 1;
  let atual = 1;

  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i] === ordenados[i - 1] + 1) {
      atual++;
      maior = Math.max(maior, atual);
    } else {
      atual = 1;
    }
  }

  return maior;
}

function media(lista) {
  if (!lista.length) return 0;
  return lista.reduce((acc, n) => acc + n, 0) / lista.length;
}

function normalizar(valor, min, max) {
  if (max === min) return 0;
  const limitado = Math.max(min, Math.min(max, valor));
  return (limitado - min) / (max - min);
}

function renderResumo(analise, leitura, previsao = null, backtest = null) {
  const top10 = analise.ranking
    .slice(0, 10)
    .map((item) => formatar(item.numero))
    .join(", ");

  const atrasados = [...analise.ranking]
    .sort((a, b) => b.atraso - a.atraso)
    .slice(0, 5)
    .map((item) => formatar(item.numero))
    .join(", ");

  const ultimo = leitura.concursos[leitura.concursos.length - 1];
  const texto = [
    `Linhas lidas: ${leitura.totalLinhas}`,
    `Sequencias validas: ${leitura.validos}`,
    `Descartadas por erro: ${leitura.invalidos}`,
    `Concursos duplicados removidos: ${leitura.duplicados}`,
    `Ultimo concurso lido: ${ultimo.map(formatar).join(" ")}`,
    `Numeros mais fortes: ${top10}`,
    `Mais atrasados: ${atrasados}`,
    `Meta de repeticao com ultimo concurso: ${analise.meta.repeticoesUltimoMin} a ${analise.meta.repeticoesUltimoMax}`,
    backtest && backtest.rodadas ? `Backtesting medio: ${backtest.mediaAcertos.toFixed(2)} acertos (${backtest.percentualMedio.toFixed(1)}%)` : "Backtesting ainda indisponivel.",
    previsao ? `Previsao principal: ${previsao.map(formatar).join(" ")}` : "Clique em gerar para montar os jogos sugeridos."
  ].join("\n");

  resumoEl.textContent = texto;
}

function renderRanking(ranking) {
  rankingEl.innerHTML = ranking
    .map((item) => {
      return `
        <div class="rank-card">
          <div class="num">${formatar(item.numero)}</div>
          <div class="score">${item.score.toFixed(3)}</div>
        </div>
      `;
    })
    .join("");
}

function renderMenosProvaveis(analise) {
  const menosProvaveis = [...analise.ranking]
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  menosProvaveisEl.innerHTML = menosProvaveis
    .map((item) => {
      const motivos = [];
      if (item.recente <= 2) motivos.push("baixa presenca recente");
      if (item.tendencia < 0) motivos.push("tendencia de queda");
      if (item.transitionSignal < 0.35) motivos.push("transicao fraca");
      if (item.paresFortes < 20) motivos.push("baixa coocorrencia");

      return `
        <div class="rank-card rank-card-low">
          <div class="num">${formatar(item.numero)}</div>
          <div class="score">score ${item.score.toFixed(3)}</div>
          <div class="low-reason">${motivos.slice(0, 2).join(" • ") || "aderencia baixa ao padrao"}</div>
        </div>
      `;
    })
    .join("");
}
function renderJogos(jogos) {
  previsoesEl.innerHTML = jogos
    .map((jogo, index) => {
      const numeros = normalizarJogo(jogo.numeros);
      const bolas = numeros
        .map((n) => `<div class="ball predicted">${formatar(n)}</div>`)
        .join("");

      return `
        <article class="game-card">
          <div class="game-header">
            <h3 class="game-title">Jogo ${index + 1}</h3>
            <div class="game-badges">
              <span class="badge badge-green">${jogo.performance.percentual.toFixed(1)}% estimado</span>
            </div>
          </div>
          <div class="balls">${bolas}</div>
        </article>
      `;
    })
    .join("");
}

function renderBacktest(backtest, previsao = null, ultimoConcurso = null) {
  if (!backtest.rodadas) {
    comparacaoEl.textContent = backtest.detalhe;
    return;
  }

  const dist = Object.keys(backtest.distribuicao)
    .sort((a, b) => Number(a) - Number(b))
    .map((chave) => `${chave} acertos: ${backtest.distribuicao[chave]}x`)
    .join(" | ");

  const linhas = [
    backtest.detalhe,
    `Media de acertos: ${backtest.mediaAcertos.toFixed(2)} de ${GAME_SIZE} (${backtest.percentualMedio.toFixed(1)}%)`,
    `Melhor rodada: ${backtest.melhorAcerto} acertos`,
    `Pior rodada: ${backtest.piorAcerto} acertos`,
    `Distribuicao: ${dist}`
  ];

  if (previsao && ultimoConcurso) {
    const acertosAgora = contarAcertos(previsao, ultimoConcurso);
    linhas.push(`Ultimo concurso: ${ultimoConcurso.map(formatar).join(" ")}`);
    linhas.push(`Previsao principal: ${previsao.map(formatar).join(" ")}`);
    linhas.push(`Coincidencias com o ultimo concurso: ${acertosAgora}`);
  }

  comparacaoEl.textContent = linhas.join("\n");
}

function renderGraficos(analise) {
  const labels = Object.values(analise.stats).map((item) => formatar(item.numero));
  const freqData = Object.values(analise.stats).map((item) => Number(item.weightedFreq.toFixed(2)));
  const atrasoData = Object.values(analise.stats).map((item) => item.atraso);

  if (graficoFrequencia) graficoFrequencia.destroy();
  if (graficoAtraso) graficoAtraso.destroy();

  graficoFrequencia = new Chart(document.getElementById("graficoFrequencia"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Frequencia ponderada",
        data: freqData,
        backgroundColor: "rgba(34, 197, 94, 0.65)",
        borderColor: "rgba(34, 197, 94, 1)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#eff6ff" } }
      },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } }
      }
    }
  });

  graficoAtraso = new Chart(document.getElementById("graficoAtraso"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Atraso",
        data: atrasoData,
        backgroundColor: "rgba(56, 189, 248, 0.22)",
        borderColor: "rgba(56, 189, 248, 1)",
        borderWidth: 2,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#eff6ff" } }
      },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } }
      }
    }
  });
}

function renderErro(mensagem) {
  resumoEl.innerHTML = `<div class="alert">${mensagem}</div>`;
  previsoesEl.innerHTML = "";
  rankingEl.innerHTML = "";
  comparacaoEl.textContent = "";
  if (graficoFrequencia) graficoFrequencia.destroy();
  if (graficoAtraso) graficoAtraso.destroy();
}

function formatar(n) {
  return String(n).padStart(2, "0");
}





