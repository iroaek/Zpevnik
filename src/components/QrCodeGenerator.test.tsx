import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QrCodeGenerator } from './QrCodeGenerator';

const qrCode = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock('qrcode', () => ({ default: { toDataURL: qrCode.toDataURL } }));

describe('administrátorský generátor QR kódu', () => {
  afterEach(cleanup);

  beforeEach(() => {
    qrCode.toDataURL.mockReset().mockResolvedValue('data:image/png;base64,c3ludGhldGlj');
  });

  it('vytvoří lokální QR kód pro instalační odkaz a nabídne PNG', async () => {
    const user = userEvent.setup();
    render(<QrCodeGenerator />);

    expect(screen.getByLabelText('Odkaz pro QR kód')).toHaveValue('http://localhost:3000/install');
    await user.click(screen.getByRole('button', { name: 'Vytvořit QR kód' }));

    expect(qrCode.toDataURL).toHaveBeenCalledWith('http://localhost:3000/install', expect.objectContaining({ width: 768, errorCorrectionLevel: 'M' }));
    expect(await screen.findByRole('img', { name: /QR kód pro adresu/ })).toHaveAttribute('src', 'data:image/png;base64,c3ludGhldGlj');
    expect(screen.getByRole('link', { name: 'Stáhnout QR jako PNG' })).toHaveAttribute('download', 'zpevnik-qr-kod.png');
  });

  it('odmítne adresu mimo webové protokoly', async () => {
    const user = userEvent.setup();
    render(<QrCodeGenerator />);

    const input = screen.getByLabelText('Odkaz pro QR kód');
    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Vytvořit QR kód' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('http:// nebo https://');
    expect(qrCode.toDataURL).not.toHaveBeenCalled();
  });
});
