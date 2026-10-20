using Vistoria.Api.Model;

namespace Vistoria.Api.Repositories;

public interface IUserRepository
{
    /// <param name="normalizedEmail">Já normalizado por <see cref="User.NormalizeEmail"/>.</param>
    Task<bool> EmailExistsAsync(string normalizedEmail, CancellationToken cancellationToken);

    /// <param name="normalizedEmail">Já normalizado por <see cref="User.NormalizeEmail"/>.</param>
    Task<User?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    /// <summary>Grava o usuário. Lança <see cref="DuplicateEmailException"/> se o e-mail já existir.</summary>
    Task AddAsync(User user, CancellationToken cancellationToken);

    /// <summary>Regrava só o <see cref="User.PasswordHash"/> de um usuário já gravado.</summary>
    Task UpdatePasswordHashAsync(User user, CancellationToken cancellationToken);
}

/// <summary>O índice único de e-mail recusou a gravação: outro cadastro com o mesmo e-mail ganhou a corrida.</summary>
public sealed class DuplicateEmailException(Exception inner) : Exception("E-mail já cadastrado.", inner);
