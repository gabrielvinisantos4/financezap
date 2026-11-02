"use client";

import Link from "next/link";
import { useState } from "react";

/** Campos de cadastro com confirmação de e-mail e senha (verificados também no servidor). */
export function SignupFields() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [terms, setTerms] = useState(false);

  const emailMismatch = emailConfirm.length > 0 && emailConfirm.trim().toLowerCase() !== email.trim().toLowerCase();
  const passwordMismatch = passwordConfirm.length > 0 && passwordConfirm !== password;
  const blockPaste = (e: React.ClipboardEvent) => e.preventDefault();

  return (
    <>
      <label className="field">
        <span>Nome</span>
        <input className="input" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input className="input" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>Confirmar e-mail</span>
        <input
          className={`input ${emailMismatch ? "border-loss" : ""}`}
          type="email"
          name="emailConfirm"
          autoComplete="off"
          value={emailConfirm}
          onChange={(e) => setEmailConfirm(e.target.value)}
          onPaste={blockPaste}
          aria-invalid={emailMismatch}
          aria-describedby="email-confirm-hint"
          required
        />
        <small id="email-confirm-hint" className={emailMismatch ? "text-loss" : "text-ink-faint"}>
          {emailMismatch ? "Os e-mails não conferem." : "Digite o e-mail novamente."}
        </small>
      </label>
      <label className="field">
        <span>WhatsApp (com DDD)</span>
        <input className="input" type="tel" name="phone" autoComplete="tel" inputMode="tel" placeholder="(44) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">
        <span>Senha</span>
        <input
          className="input"
          type={show ? "text" : "password"}
          name="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-describedby="pw-hint"
        />
        <small id="pw-hint" className="text-ink-faint">Pelo menos 10 caracteres, com letras e números.</small>
      </label>
      <label className="field">
        <span>Confirmar senha</span>
        <input
          className={`input ${passwordMismatch ? "border-loss" : ""}`}
          type={show ? "text" : "password"}
          name="passwordConfirm"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          onPaste={blockPaste}
          aria-invalid={passwordMismatch}
          aria-describedby="pw-confirm-hint"
          required
        />
        <small id="pw-confirm-hint" className={passwordMismatch ? "text-loss" : "text-ink-faint"}>
          {passwordMismatch ? "As senhas não conferem." : "Digite a senha novamente."}
        </small>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-[#1b2a4a]" />
        Mostrar senha
      </label>
      <label className="flex items-start gap-3 text-sm text-ink-soft">
        <input type="checkbox" name="acceptTerms" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-4 w-4 accent-[#1b2a4a]" required />
        <span>
          Li e aceito os <Link href="/termos" className="underline" target="_blank">Termos de uso</Link> e a{" "}
          <Link href="/privacidade" className="underline" target="_blank">Política de privacidade</Link>.
        </span>
      </label>
    </>
  );
}
