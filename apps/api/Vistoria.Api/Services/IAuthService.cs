using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Services;

public interface IAuthService
{
    /// <summary>Cria a conta e já devolve a sessão. E-mail já usado → <c>ValidationException</c> em <c>email</c>.</summary>
    Task<AuthDto> SignUpAsync(SignUpDto request, CancellationToken cancellationToken);

    /// <summary>
    /// Confere a senha e devolve a sessão. Senha errada e e-mail inexistente → a mesma
    /// <c>InvalidCredentialsException</c>.
    /// </summary>
    Task<AuthDto> SignInAsync(SignInDto request, CancellationToken cancellationToken);
}
