import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { finalize, switchMap } from 'rxjs/operators';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Api, Nota, NotaItem, Produto } from './api';

@Component({
  selector: 'app-notas',
  imports: [
    FormsModule, DatePipe, TableModule, ButtonModule, DialogModule,
    SelectModule, InputNumberModule, TagModule, ToggleSwitchModule,
  ],
  template: `
    <div class="topo">
      <p-button label="Nova nota" icon="pi pi-plus" (onClick)="abrirDialogo()" />
      <div class="simulador">
        <p-toggleswitch [(ngModel)]="estoqueForaDoAr" (onChange)="alternarFalha()" />
        <span>Simular falha no Estoque</span>
      </div>
    </div>

    <p-table
      [value]="notas()"
      [loading]="carregando()"
      dataKey="id"
      [expandedRowKeys]="expandidas"
      styleClass="p-datatable-sm"
    >
      <ng-template #header>
        <tr>
          <th style="width:3rem"></th>
          <th style="width:7rem">Número</th>
          <th style="width:8rem">Status</th>
          <th>Criada em</th>
          <th style="width:11rem"></th>
        </tr>
      </ng-template>
      <ng-template #body let-n let-expandida="expanded">
        <tr>
          <td>
            <p-button
              type="button"
              [text]="true"
              [rounded]="true"
              [icon]="expandida ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
              [pRowToggler]="n"
            />
          </td>
          <td>{{ n.numero }}</td>
          <td>
            <p-tag [value]="n.status" [severity]="n.status === 'Aberta' ? 'info' : 'success'" />
          </td>
          <td>{{ n.criadaEm | date: 'dd/MM/yyyy HH:mm' }}</td>
          <td>
            @if (n.status === 'Aberta') {
              <p-button
                label="Imprimir"
                icon="pi pi-print"
                [loading]="imprimindo() === n.id"
                (onClick)="imprimir(n)"
              />
            } @else {
              <p-button
                label="Ver PDF"
                icon="pi pi-file-pdf"
                severity="secondary"
                [outlined]="true"
                (onClick)="abrirPdf(n)"
              />
            }
          </td>
        </tr>
      </ng-template>
      <ng-template #expandedrow let-n>
        <tr>
          <td colspan="5">
            <table class="itens">
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th class="direita">Qtde</th>
              </tr>
              @for (i of n.itens; track i.produtoId) {
                <tr>
                  <td>{{ i.codigo }}</td>
                  <td>{{ i.descricao }}</td>
                  <td class="direita">{{ i.quantidade }}</td>
                </tr>
              }
            </table>
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr>
          <td colspan="5">Nenhuma nota emitida.</td>
        </tr>
      </ng-template>
    </p-table>

    <p-dialog header="Nova nota fiscal" [(visible)]="dialogo" [modal]="true" [style]="{ width: '34rem' }">
      <div class="linha">
        <div class="cresce">
          <p-select
            [(ngModel)]="produtoSelecionado"
            [options]="produtos()"
            optionLabel="descricao"
            placeholder="Selecione o produto"
            [filter]="true"
            filterBy="codigo,descricao"
            appendTo="body"
            [fluid]="true"
          >
            <ng-template #item let-p>{{ p.codigo }} - {{ p.descricao }} (saldo {{ p.saldo }})</ng-template>
          </p-select>
        </div>
        <div class="qtde">
          <p-inputnumber [(ngModel)]="quantidade" [min]="1" [showButtons]="true" [fluid]="true" />
        </div>
        <p-button icon="pi pi-plus" [rounded]="true" (onClick)="adicionarItem()" />
      </div>

      @if (itens().length) {
        <table class="itens">
          @for (i of itens(); track i.produtoId) {
            <tr>
              <td>{{ i.codigo }} - {{ i.descricao }}</td>
              <td class="direita">{{ i.quantidade }}</td>
              <td>
                <p-button icon="pi pi-trash" [text]="true" severity="danger" (onClick)="removerItem(i)" />
              </td>
            </tr>
          }
        </table>
      } @else {
        <p class="vazio">Nenhum produto incluído.</p>
      }

      <ng-template #footer>
        <p-button label="Cancelar" [text]="true" (onClick)="dialogo = false" />
        <p-button label="Criar nota" icon="pi pi-check" [loading]="salvando()" (onClick)="criar()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .simulador { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: var(--p-text-muted-color); }
    .linha { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 1rem; }
    .cresce { flex: 1; min-width: 0; }
    .qtde { width: 8.5rem; flex: none; }
    .itens { width: 100%; border-collapse: collapse; }
    .itens td, .itens th { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid var(--p-content-border-color); }
    .direita { text-align: right; }
    .vazio { color: var(--p-text-muted-color); font-size: 0.9rem; }
  `,
})
export class Notas implements OnInit {
  private api = inject(Api);
  private toast = inject(MessageService);

  notas = signal<Nota[]>([]);
  produtos = signal<Produto[]>([]);
  itens = signal<NotaItem[]>([]);
  carregando = signal(false);
  salvando = signal(false);
  imprimindo = signal<number | null>(null);
  expandidas: Record<string, boolean> = {};
  dialogo = false;
  estoqueForaDoAr = false;
  produtoSelecionado: Produto | null = null;
  quantidade = 1;

  ngOnInit() {
    this.carregar();
    this.api.falhaEstoque().subscribe({ next: (r) => (this.estoqueForaDoAr = r.falhaAtiva), error: () => {} });
  }

  carregar() {
    this.carregando.set(true);
    this.api
      .notas()
      .pipe(finalize(() => this.carregando.set(false)))
      .subscribe({ next: (n) => this.notas.set(n), error: (e) => this.erro(e.message) });
  }

  abrirDialogo() {
    this.itens.set([]);
    this.produtoSelecionado = null;
    this.quantidade = 1;
    this.dialogo = true;
    this.api.produtos().subscribe({
      next: (p) => this.produtos.set(p.filter((x) => x.ativo)),
      error: (e) => this.erro(e.message),
    });
  }

  adicionarItem() {
    const p = this.produtoSelecionado;
    if (!p || this.quantidade < 1) {
      this.erro('Selecione produto e quantidade.');
      return;
    }
    this.itens.update((lista) => {
      const existente = lista.find((i) => i.produtoId === p.id);
      return existente
        ? lista.map((i) => (i.produtoId === p.id ? { ...i, quantidade: i.quantidade + this.quantidade } : i))
        : [...lista, { produtoId: p.id, codigo: p.codigo, descricao: p.descricao, quantidade: this.quantidade }];
    });
    this.produtoSelecionado = null;
    this.quantidade = 1;
  }

  removerItem(item: NotaItem) {
    this.itens.update((lista) => lista.filter((i) => i.produtoId !== item.produtoId));
  }

  criar() {
    if (!this.itens().length) {
      this.erro('Inclua ao menos um produto.');
      return;
    }
    this.salvando.set(true);
    this.api
      .criarNota(this.itens())
      .pipe(finalize(() => this.salvando.set(false)))
      .subscribe({
        next: (n) => {
          this.notas.update((lista) => [n, ...lista]);
          this.toast.add({ severity: 'success', summary: `Nota ${n.numero} criada`, detail: 'Status Aberta' });
          this.dialogo = false;
        },
        error: (e) => this.erro(e.message),
      });
  }

  imprimir(nota: Nota) {
    this.imprimindo.set(nota.id);
    this.api
      .imprimir(nota.id)
      .pipe(
        switchMap(() => this.api.notas()),
        finalize(() => this.imprimindo.set(null)),
      )
      .subscribe({
        next: (lista) => {
          this.notas.set(lista);
          this.abrirPdf(nota);
          this.toast.add({
            severity: 'success',
            summary: `Nota ${nota.numero} impressa`,
            detail: 'Status Fechada, saldo atualizado. PDF gerado.',
          });
        },
        error: (e) => this.erro(e.message),
      });
  }

  abrirPdf(nota: Nota) {
    window.open(this.api.pdfUrl(nota.id), '_blank');
  }

  alternarFalha() {
    this.api.alternarFalhaEstoque(this.estoqueForaDoAr).subscribe({
      next: (r) =>
        this.toast.add({
          severity: r.falhaAtiva ? 'warn' : 'info',
          summary: r.falhaAtiva ? 'Estoque fora do ar' : 'Estoque no ar',
          detail: r.falhaAtiva ? 'Imprima uma nota para ver o tratamento da falha.' : 'Serviço restabelecido.',
        }),
      error: (e) => this.erro(e.message),
    });
  }

  private erro(detail: string) {
    this.toast.add({ severity: 'error', summary: 'Erro', detail, life: 6000 });
  }
}
