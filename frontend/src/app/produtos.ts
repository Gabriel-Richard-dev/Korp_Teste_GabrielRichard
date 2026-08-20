import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { Api, Produto } from './api';

@Component({
  selector: 'app-produtos',
  imports: [
    FormsModule, TableModule, ButtonModule, InputTextModule, InputNumberModule,
    CardModule, DialogModule, TagModule, ToggleSwitchModule,
  ],
  template: `
    <p-card header="Cadastro de produtos">
      <form class="form" (ngSubmit)="salvar()">
        <label>
          Código
          <input pInputText [(ngModel)]="codigo" name="codigo" placeholder="P001" required />
        </label>
        <label class="cresce">
          Descrição
          <input pInputText [(ngModel)]="descricao" name="descricao" placeholder="Teclado mecânico" required />
        </label>
        <label>
          Saldo
          <p-inputnumber [(ngModel)]="saldo" name="saldo" [min]="0" [showButtons]="true" />
        </label>
        <p-button type="submit" label="Cadastrar" icon="pi pi-plus" [loading]="salvando()" />
      </form>
    </p-card>

    <p-table [value]="produtos()" [loading]="carregando()" styleClass="p-datatable-sm tabela">
      <ng-template #header>
        <tr>
          <th style="width:9rem">Código</th>
          <th>Descrição</th>
          <th style="width:7rem" class="direita">Saldo</th>
          <th style="width:7rem">Situação</th>
          <th style="width:9rem"></th>
        </tr>
      </ng-template>
      <ng-template #body let-p>
        <tr [class.inativo]="!p.ativo">
          <td>{{ p.codigo }}</td>
          <td>{{ p.descricao }}</td>
          <td class="direita">{{ p.saldo }}</td>
          <td>
            <p-tag
              [value]="p.ativo ? 'Ativo' : 'Inativo'"
              [severity]="p.ativo ? 'success' : 'secondary'"
            />
          </td>
          <td class="acoes">
            <p-button icon="pi pi-pencil" [text]="true" [rounded]="true" (onClick)="editar(p)" />
            <p-button
              [icon]="p.ativo ? 'pi pi-ban' : 'pi pi-check'"
              [text]="true"
              [rounded]="true"
              [severity]="p.ativo ? 'danger' : 'success'"
              [loading]="alternando() === p.id"
              (onClick)="alternarAtivo(p)"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template #emptymessage>
        <tr>
          <td colspan="5">Nenhum produto cadastrado.</td>
        </tr>
      </ng-template>
    </p-table>

    <p-dialog header="Editar produto" [(visible)]="dialogo" [modal]="true" [style]="{ width: '30rem' }">
      <div class="edicao">
        <label>
          Código
          <input pInputText [(ngModel)]="edicao.codigo" name="edCodigo" />
        </label>
        <label>
          Descrição
          <input pInputText [(ngModel)]="edicao.descricao" name="edDescricao" />
        </label>
        <label>
          Adicionar ao saldo (atual: {{ edicao.saldo }})
          <p-inputnumber [(ngModel)]="entrada" name="entrada" [min]="0" [showButtons]="true" [fluid]="true" />
        </label>
        <div class="switch">
          <p-toggleswitch [(ngModel)]="edicao.ativo" name="edAtivo" />
          <span>Produto ativo</span>
        </div>
      </div>
      <ng-template #footer>
        <p-button label="Cancelar" [text]="true" (onClick)="dialogo = false" />
        <p-button label="Salvar" icon="pi pi-check" [loading]="editando()" (onClick)="salvarEdicao()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .form { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .form label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
    .cresce { flex: 1; min-width: 14rem; }
    .tabela { margin-top: 1.5rem; }
    .direita { text-align: right; }
    .acoes { display: flex; gap: 0.2rem; }
    .inativo td:not(:nth-child(4)) { opacity: 0.55; }
    .edicao { display: flex; flex-direction: column; gap: 1rem; }
    .edicao label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
    .switch { display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; }
  `,
})
export class Produtos implements OnInit {
  private api = inject(Api);
  private toast = inject(MessageService);

  produtos = signal<Produto[]>([]);
  carregando = signal(false);
  salvando = signal(false);
  editando = signal(false);
  alternando = signal<number | null>(null);
  codigo = '';
  descricao = '';
  saldo = 0;
  texto = '';
  dialogo = false;
  entrada = 0;
  edicao: Produto = { id: 0, codigo: '', descricao: '', saldo: 0, ativo: true };

  constructor() {
    effect(() => {
      if (this.api.estoqueMudou()) this.carregar();
    });
  }

  ngOnInit() {
    this.carregar();
  }

  carregar() {
    this.carregando.set(true);
    this.api
      .produtos()
      .pipe(finalize(() => this.carregando.set(false)))
      .subscribe({
        next: (p) => this.produtos.set(p),
        error: (e) => this.erro(e.message),
      });
  }

  salvar() {
    if (!this.codigo.trim() || !this.descricao.trim()) {
      this.erro('Informe código e descrição.');
      return;
    }
    this.salvando.set(true);
    this.api
      .criarProduto({ codigo: this.codigo.trim(), descricao: this.descricao.trim(), saldo: this.saldo ?? 0, ativo: true })
      .pipe(finalize(() => this.salvando.set(false)))
      .subscribe({
        next: (p) => {
          this.incluir(p);
          this.toast.add({ severity: 'success', summary: 'Produto cadastrado', detail: p.descricao });
          this.codigo = this.descricao = '';
          this.saldo = 0;
        },
        error: (e) => this.erro(e.message),
      });
  }

  editar(p: Produto) {
    this.edicao = { ...p };
    this.entrada = 0;
    this.dialogo = true;
  }

  salvarEdicao() {
    if (!this.edicao.codigo.trim() || !this.edicao.descricao.trim()) {
      this.erro('Informe código e descrição.');
      return;
    }
    const quantidade = this.entrada ?? 0;
    this.editando.set(true);
    this.api
      .atualizarProduto(this.edicao)
      .pipe(
        switchMap((p) => (quantidade > 0 ? this.api.entradaSaldo(p.id, quantidade) : of(p))),
        finalize(() => this.editando.set(false)),
      )
      .subscribe({
        next: (p) => {
          this.substituir(p);
          this.toast.add({ severity: 'success', summary: 'Produto atualizado', detail: p.descricao });
          this.dialogo = false;
        },
        error: (e) => this.erro(e.message),
      });
  }

  alternarAtivo(p: Produto) {
    this.alternando.set(p.id);
    this.api
      .atualizarProduto({ ...p, ativo: !p.ativo })
      .pipe(finalize(() => this.alternando.set(null)))
      .subscribe({
        next: (atualizado) => {
          this.substituir(atualizado);
          this.toast.add({
            severity: 'info',
            summary: atualizado.ativo ? 'Produto ativado' : 'Produto desativado',
            detail: atualizado.descricao,
          });
        },
        error: (e) => this.erro(e.message),
      });
  }

  private incluir(p: Produto) {
    this.produtos.update((lista) => [...lista, p].sort((a, b) => a.codigo.localeCompare(b.codigo)));
  }

  private substituir(p: Produto) {
    this.produtos.update((lista) => lista.map((x) => (x.id === p.id ? p : x)));
  }

  private erro(detail: string) {
    this.toast.add({ severity: 'error', summary: 'Erro', detail, life: 6000 });
  }
}
