import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Api, MensagemChat } from './api';

@Component({
  selector: 'app-chat',
  imports: [FormsModule, ButtonModule, InputTextModule],
  template: `
    @if (aberto()) {
      <section class="janela">
        <header>
          <span><i class="pi pi-comments"></i> Assistente de estoque</span>
          <p-button icon="pi pi-times" [text]="true" [rounded]="true" (onClick)="aberto.set(false)" />
        </header>

        <div class="mensagens" #rolagem>
          @for (m of mensagens(); track $index) {
            <p class="balao" [class.usuario]="m.papel === 'user'">{{ m.texto }}</p>
          }
          @if (pensando()) {
            <p class="balao pensando">Pensando...</p>
          }
        </div>

        <form (ngSubmit)="enviar()">
          <input
            pInputText
            [(ngModel)]="texto"
            name="texto"
            placeholder="Cadastre 20 teclados código TEC20"
            [disabled]="pensando()"
          />
          <p-button type="submit" icon="pi pi-send" [disabled]="pensando()" />
        </form>
      </section>
    } @else {
      <p-button
        class="bolha"
        icon="pi pi-comments"
        [rounded]="true"
        size="large"
        (onClick)="aberto.set(true)"
      />
    }
  `,
  styles: `
    :host { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 1000; }
    .janela {
      display: flex;
      flex-direction: column;
      width: 22rem;
      height: 26rem;
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: 10px;
      box-shadow: 0 12px 30px rgb(0 0 0 / 18%);
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.4rem 0.4rem 0.4rem 0.9rem;
      background: var(--p-primary-color);
      color: var(--p-primary-contrast-color);
      font-size: 0.9rem;
    }
    .mensagens { flex: 1; overflow-y: auto; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .balao {
      margin: 0;
      padding: 0.5rem 0.7rem;
      border-radius: 8px;
      background: var(--p-content-hover-background);
      font-size: 0.88rem;
      white-space: pre-line;
      max-width: 85%;
    }
    .balao.usuario { align-self: flex-end; background: var(--p-primary-color); color: var(--p-primary-contrast-color); }
    .balao.pensando { opacity: 0.6; }
    form { display: flex; gap: 0.4rem; padding: 0.6rem; border-top: 1px solid var(--p-content-border-color); }
    form input { flex: 1; }
  `,
})
export class Chat {
  private api = inject(Api);
  private rolagem = viewChild<ElementRef<HTMLElement>>('rolagem');

  aberto = signal(false);
  pensando = signal(false);
  mensagens = signal<MensagemChat[]>([
    { papel: 'assistant', texto: 'Posso cadastrar produtos, somar saldo e consultar o estoque.' },
  ]);
  texto = '';

  enviar() {
    const texto = this.texto.trim();
    if (!texto || this.pensando()) return;

    this.mensagens.update((m) => [...m, { papel: 'user', texto }]);
    this.texto = '';
    this.pensando.set(true);
    this.rolar();

    this.api
      .chat(this.mensagens())
      .pipe(finalize(() => this.pensando.set(false)))
      .subscribe({
        next: (r) => {
          this.mensagens.update((m) => [...m, { papel: 'assistant', texto: r.resposta }]);
          if (r.recarregar) this.api.estoqueMudou.update((n) => n + 1);
          this.rolar();
        },
        error: (e) => {
          this.mensagens.update((m) => [...m, { papel: 'assistant', texto: e.message }]);
          this.rolar();
        },
      });
  }

  private rolar() {
    setTimeout(() => {
      const el = this.rolagem()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
