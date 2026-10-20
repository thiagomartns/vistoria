using Microsoft.AspNetCore.Identity;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class AuthService(
    IUserRepository users,
    IPasswordHasher<User> passwordHasher,
    AccessTokenGenerator tokens,
    TimeProvider time) : IAuthService
{
    private const string EmailField = "email";
    private const string EmailTaken = "E-mail já cadastrado.";

    // Hash de uma senha que ninguém tem: o signin de e-mail inexistente confere contra ele e custa o mesmo PBKDF2
    // que o de senha errada, então o tempo de resposta não revela quais e-mails têm conta.
    private static string? s_unknownUserHash;

    public async Task<AuthDto> SignUpAsync(SignUpDto request, CancellationToken cancellationToken)
    {
        var email = User.NormalizeEmail(request.Email);
        if (await users.EmailExistsAsync(email, cancellationToken))
        {
            throw new ValidationException(EmailField, EmailTaken);
        }

        var now = time.GetUtcNow();
        var user = new User
        {
            Id = Guid.CreateVersion7(now),
            Name = request.Name.Trim(),
            Email = email,
            CreatedAt = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        try
        {
            await users.AddAsync(user, cancellationToken);
        }
        catch (DuplicateEmailException)
        {
            // Dois cadastros com o mesmo e-mail passaram juntos pela checagem; o índice único decidiu.
            throw new ValidationException(EmailField, EmailTaken);
        }

        return Session(user);
    }

    public async Task<AuthDto> SignInAsync(SignInDto request, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(User.NormalizeEmail(request.Email), cancellationToken);
        if (user is null)
        {
            s_unknownUserHash ??= passwordHasher.HashPassword(new User(), Guid.NewGuid().ToString());
            passwordHasher.VerifyHashedPassword(new User(), s_unknownUserHash, request.Password);
            throw new InvalidCredentialsException();
        }

        switch (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password))
        {
            case PasswordVerificationResult.Success:
                break;
            case PasswordVerificationResult.SuccessRehashNeeded:
                // Hash em formato ou custo antigo (como os SHA-256 do curso): regrava no atual, com a senha certa em mãos.
                user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
                await users.UpdatePasswordHashAsync(user, cancellationToken);
                break;
            default:
                throw new InvalidCredentialsException();
        }

        return Session(user);
    }

    private AuthDto Session(User user)
    {
        var token = tokens.Create(user);
        return new AuthDto(token.Token, token.ExpiresAt, new AuthUserDto(user.Id, user.Name));
    }
}
