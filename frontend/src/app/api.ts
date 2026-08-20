import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

const ESTOQUE = '/api/estoque';
const FATURAMENTO = '/api/faturamento';

export interface Produto {
  id: number;
  codigo: string;
  descricao: string;
  saldo: number;
  ativo: boolean;
}

export interface NotaItem {
  produtoId: number;
  codigo: string;
  descricao: string;
  quantidade: number;
}

export interface Nota {
  id: number;
  numero: number;
  status: 'Aberta' | 'Fechada';
  criadaEm: string;
  impressaEm?: string;
  itens: NotaItem[];
}

export interface MensagemChat {
  papel: 'user' | 'assistant';
  texto: string;
}

export interface ChatResposta {
  resposta: string;
  recarregar: boolean;
}

function mensagemDeErro(e: HttpErrorResponse): string {
  if (e.status === 0) return 'Servidor fora do ar.';
  return e.error?.erro ?? e.error?.detail ?? e.error?.title ?? `Erro ${e.status}.`;
}

const comErro = <T>(o: Observable<T>) =>
  o.pipe(catchError((e: HttpErrorResponse) => throwError(() => new Error(mensagemDeErro(e)))));

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  produtos = () => comErro(this.http.get<Produto[]>(`${ESTOQUE}/produtos`));

  criarProduto = (p: Omit<Produto, 'id'>) =>
    comErro(this.http.post<Produto>(`${ESTOQUE}/produtos`, p));

  atualizarProduto = (p: Produto) =>
    comErro(this.http.put<Produto>(`${ESTOQUE}/produtos/${p.id}`, p));

  entradaSaldo = (id: number, quantidade: number) =>
    comErro(this.http.post<Produto>(`${ESTOQUE}/produtos/${id}/entrada`, { quantidade }));

  estoqueMudou = signal(0);

  chat = (mensagens: MensagemChat[]) =>
    comErro(this.http.post<ChatResposta>(`${ESTOQUE}/chat`, { mensagens }));

  falhaEstoque = () => comErro(this.http.get<{ falhaAtiva: boolean }>(`${ESTOQUE}/admin/falha`));

  alternarFalhaEstoque = (ativa: boolean) =>
    comErro(this.http.post<{ falhaAtiva: boolean }>(`${ESTOQUE}/admin/falha?ativa=${ativa}`, {}));

  notas = () => comErro(this.http.get<Nota[]>(`${FATURAMENTO}/notas`));

  criarNota = (itens: NotaItem[]) =>
    comErro(this.http.post<Nota>(`${FATURAMENTO}/notas`, { itens }));

  pdfUrl = (id: number) => `${FATURAMENTO}/notas/${id}/pdf`;

  imprimir = (id: number) =>
    comErro(this.http.post<Nota>(`${FATURAMENTO}/notas/${id}/imprimir`, {}));
}
