using System.Reflection;
using System.Runtime.CompilerServices;
using AwesomeAssertions;
using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Tests.Integration;

namespace Vistoria.Api.Tests.Unit;

// DTO de entrada é record ou classe com propriedades { get; init; } (apps/api/CLAUDE.md). Record posicional faz a
// chave do erro sair em PascalCase (o SystemTextJsonValidationMetadataProvider não atua nos parâmetros do
// construtor), e o modificador `required` faz o System.Text.Json falhar antes da validação, sem caminho do campo.
public class RequestDtoConventionTests
{
    [Fact]
    public void ApiBodyDtos_FollowTheConvention()
    {
        var bodyTypes = typeof(Program).Assembly.GetTypes()
            .Where(t => t.IsSubclassOf(typeof(ControllerBase)) && !t.IsAbstract)
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .SelectMany(m => m.GetParameters())
            .Select(p => p.ParameterType)
            .Where(IsDto);

        bodyTypes.SelectMany(Violations).Should().BeEmpty();
    }

    [Fact]
    public void Convention_AcceptsTheTestDto()
    {
        Violations(typeof(ValidationDto)).Should().BeEmpty();
    }

    [Fact]
    public void Convention_RejectsPositionalRecord()
    {
        Violations(typeof(PositionalDto)).Should().ContainSingle().Which.Should().Contain("posicional");
    }

    [Fact]
    public void Convention_RejectsRequiredModifier_AlsoInNestedTypes()
    {
        Violations(typeof(ParentDto)).Should().ContainSingle().Which.Should().Contain(nameof(RequiredMemberDto));
    }

    // Percorre o DTO e os tipos aninhados (propriedades e elementos de lista) declarados no repositório.
    private static List<string> Violations(Type root)
    {
        var violations = new List<string>();
        var seen = new HashSet<Type>();
        var pending = new Stack<Type>([root]);
        while (pending.TryPop(out var type))
        {
            if (!seen.Add(type))
            {
                continue;
            }

            if (IsPositionalRecord(type))
            {
                violations.Add($"{type.Name}: record posicional");
            }

            if (type.IsDefined(typeof(RequiredMemberAttribute), inherit: false))
            {
                violations.Add($"{type.Name}: modificador required");
            }

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var propertyType = property.PropertyType;
                var element = propertyType.IsGenericType ? propertyType.GetGenericArguments()[0] : propertyType;
                if (IsDto(element))
                {
                    pending.Push(element);
                }
            }
        }

        return violations;
    }

    private static bool IsDto(Type type) =>
        type.IsClass && type.Namespace?.StartsWith("Vistoria.", StringComparison.Ordinal) == true;

    // Record: o compilador gera <Clone>$. Posicional: um construtor cujos parâmetros são todos propriedades.
    private static bool IsPositionalRecord(Type type) =>
        type.GetMethod("<Clone>$") is not null
        && type.GetConstructors().Any(c =>
        {
            var parameters = c.GetParameters();
            return parameters.Length > 0
                && parameters.All(p => type.GetProperty(p.Name!) is not null)
                && !(parameters.Length == 1 && parameters[0].ParameterType == type);
        });

    private sealed record PositionalDto(string Name);

    private sealed record RequiredMemberDto
    {
        public required string Name { get; init; }
    }

    private sealed record ParentDto
    {
        public List<RequiredMemberDto> Items { get; init; } = [];
    }
}
