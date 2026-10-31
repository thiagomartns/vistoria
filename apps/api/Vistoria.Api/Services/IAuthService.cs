using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;

namespace Vistoria.Api.Services;

/// <summary>Uma sessão nova: o corpo da resposta e o refresh token de uma família nova, que vai no cookie.</summary>
public sealed record AuthSession(AuthDto Body, IssuedRefreshToken RefreshToken);

/// <summary>
/// Um <c>refresh</c> aceito. Sem <see cref="RefreshToken"/> na tolerância: o navegador já tem o sucessor.
/// </summary>
public sealed record RefreshResult(AccessTokenDto Body, IssuedRefreshToken? RefreshToken);

public interface IAuthService
{
    /// <summary>Cria a conta e já devolve a sessão. E-mail já usado → <c>ValidationException</c> em <c>email</c>.</summary>
    Task<AuthSession> SignUpAsync(SignUpDto request, CancellationToken cancellationToken);

    /// <summary>
    /// Confere a senha e devolve a sessão. Senha errada e e-mail inexistente → a mesma
    /// <c>InvalidCredentialsException</c>.
    /// </summary>
    Task<AuthSession> SignInAsync(SignInDto request, CancellationToken cancellationToken);

    /// <summary>
    /// Troca o refresh token do cookie por um access token e um sucessor na mesma família. Token desconhecido, vencido
    /// ou de família no teto → <c>UnauthorizedException</c>; reusado fora da tolerância ou revogado → revoga a
    /// família e lança a mesma exceção.
    /// </summary>
    Task<RefreshResult> RefreshAsync(string? refreshToken, CancellationToken cancellationToken);

    /// <summary>
    /// Revoga a família do refresh token do cookie, em qualquer estado do token. Cookie ausente ou desconhecido não é
    /// erro: não há sessão para encerrar.
    /// </summary>
    Task SignOutAsync(string? refreshToken, CancellationToken cancellationToken);
}
